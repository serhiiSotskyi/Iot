#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import deque
from typing import Any, Deque
from urllib.parse import urlparse, urlunparse

import requests
import serial


MAX_RETRY_QUEUE = 500
SERIAL_SILENCE_EXIT_SECONDS = 60.0
DEBUG_EVENT_TYPES = frozenset({"voice_debug", "colour_debug"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read JSON lines from an Arduino over Serial and POST them to an HTTP endpoint."
    )
    parser.add_argument(
        "--port",
        default=os.getenv("SERIAL_PORT"),
        help="Serial port path, for example /dev/tty.usbmodemXXXX or COM3.",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=int(os.getenv("SERIAL_BAUD", "115200")),
        help="Serial baud rate. Default: 115200",
    )
    parser.add_argument(
        "--endpoint",
        default=os.getenv("POST_ENDPOINT", "http://localhost:3000/api/movement"),
        help="HTTP endpoint that receives each JSON event.",
    )
    parser.add_argument(
        "--control-endpoint",
        default=os.getenv("CONTROL_ENDPOINT"),
        help=(
            "Optional HTTP endpoint polled for stop commands. "
            "Defaults to /api/bridge/control next to --endpoint."
        ),
    )
    parser.add_argument(
        "--control-interval",
        type=float,
        default=float(os.getenv("CONTROL_INTERVAL", "1")),
        help="Seconds between control endpoint checks. Default: 1",
    )
    parser.add_argument(
        "--api-token",
        default=os.getenv("BRIDGE_API_TOKEN"),
        help="Bearer token for the web API. Defaults to BRIDGE_API_TOKEN.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("HTTP_TIMEOUT", "5")),
        help="HTTP timeout in seconds. Default: 5",
    )
    parser.add_argument(
        "--debug-downsample",
        type=int,
        default=int(os.getenv("BRIDGE_DEBUG_DOWNSAMPLE", "0")),
        help=(
            "Downsample firmware debug events (voice_debug, colour_debug). "
            "0 = drop all (default — keeps the dashboard and DB clean), "
            "1 = forward all, "
            "N = forward every Nth. Has no effect on functional events "
            "(setup_status, voice_start, colour_authenticated, movement, "
            "init_error)."
        ),
    )
    parser.add_argument(
        "--ingest-token",
        default=os.getenv("INGEST_TOKEN"),
        help=(
            "Optional bearer token sent as 'Authorization: Bearer <token>' "
            "on each POST. Must match the web app's INGEST_TOKEN env var when "
            "that protection is enabled."
        ),
    )
    parser.add_argument(
        "--silence-timeout",
        type=float,
        default=float(os.getenv("SERIAL_SILENCE_TIMEOUT", str(SERIAL_SILENCE_EXIT_SECONDS))),
        help=(
            "Exit non-zero if no serial data arrives for this many seconds. "
            "Useful with a process supervisor (systemd/launchd) so a yanked "
            "USB cable triggers a clean restart. Default: 60"
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print each forwarded JSON payload in addition to the HTTP status.",
    )
    return parser


def infer_control_endpoint(endpoint: str) -> str | None:
    parsed = urlparse(endpoint)
    if not parsed.scheme or not parsed.netloc:
        return None

    return urlunparse(parsed._replace(path="/api/bridge/control", params="", query="", fragment=""))


def parse_json_line(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped or not stripped.startswith("{"):
        return None

    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as exc:
        print(f"[bridge] invalid JSON skipped: {exc}", flush=True)
        return None

    if not isinstance(payload, dict):
        print("[bridge] non-object JSON skipped", flush=True)
        return None

    return payload


def post_payload(
    session: requests.Session,
    endpoint: str,
    payload: dict[str, Any],
    timeout: float,
    verbose: bool,
) -> tuple[bool, bool]:
    """POST one event. Returns (should_continue, delivered).

    delivered=False signals the caller to queue the payload for retry —
    a transport error or non-2xx response means the web app did not record it.
    """
    try:
        response = session.post(endpoint, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        print(f"[bridge] POST failed: {exc}", flush=True)
        return True, False

    if 200 <= response.status_code < 300:
        event_name = payload.get("event", "unknown")
        if verbose:
            compact = json.dumps(payload, separators=(",", ":"))
            print(f"[bridge] POST {event_name} -> {response.status_code} {compact}", flush=True)
        else:
            print(f"[bridge] POST {event_name} -> {response.status_code}", flush=True)

        try:
            response_payload = response.json()
        except ValueError:
            response_payload = {}

        if response_payload.get("stopBridge") is True:
            print("[bridge] stop requested by server; closing serial connection", flush=True)
            return False, True

        return True, True

    body = response.text.strip().replace("\n", " ")
    print(f"[bridge] HTTP {response.status_code}: {body[:200]}", flush=True)
    return True, False


def flush_retry_queue(
    session: requests.Session,
    endpoint: str,
    queue: Deque[dict[str, Any]],
    timeout: float,
    verbose: bool,
) -> tuple[bool, bool]:
    """Drain queued events oldest-first. Stop on first failure to preserve order.

    Returns (should_continue, drained_any).
    """
    drained_any = False
    while queue:
        payload = queue[0]
        should_continue, delivered = post_payload(session, endpoint, payload, timeout, verbose)
        if not delivered:
            return should_continue, drained_any
        queue.popleft()
        drained_any = True
        if not should_continue:
            return False, drained_any
    return True, drained_any


def stop_requested(
    session: requests.Session,
    control_endpoint: str | None,
    timeout: float,
) -> bool:
    if not control_endpoint:
        return False

    try:
        response = session.get(control_endpoint, timeout=timeout)
    except requests.RequestException as exc:
        print(f"[bridge] control check failed: {exc}", flush=True)
        return False

    if not 200 <= response.status_code < 300:
        body = response.text.strip().replace("\n", " ")
        print(f"[bridge] control HTTP {response.status_code}: {body[:200]}", flush=True)
        return False

    try:
        payload = response.json()
    except ValueError:
        return False

    if payload.get("stopBridge") is True:
        print("[bridge] stop requested by server; closing serial connection", flush=True)
        return True

    return False


def main() -> int:
    args = build_parser().parse_args()
    if not args.port:
        print("Missing serial port. Use --port or set SERIAL_PORT.", file=sys.stderr)
        return 2

    print(
        f"[bridge] opening {args.port} @ {args.baud}, forwarding to {args.endpoint}",
        flush=True,
    )

    session = requests.Session()
    api_token = args.api_token or args.ingest_token
    if api_token:
        session.headers["Authorization"] = f"Bearer {api_token}"
    control_endpoint = args.control_endpoint or infer_control_endpoint(args.endpoint)
    next_control_check = 0.0
    if control_endpoint:
        print(f"[bridge] polling control endpoint {control_endpoint}", flush=True)

    retry_queue: Deque[dict[str, Any]] = deque(maxlen=MAX_RETRY_QUEUE)
    queue_full_warned = False
    next_retry_at = 0.0
    retry_failures = 0
    debug_counts: dict[str, int] = {}
    debug_downsample = max(args.debug_downsample, 0)

    try:
        with serial.Serial(args.port, args.baud, timeout=1) as ser:
            # Discard any boot-time chatter sitting in the OS buffer so the
            # first parsed line is from a known state.
            ser.reset_input_buffer()
            last_data_at = time.monotonic()

            while True:
                now = time.monotonic()

                if control_endpoint and now >= next_control_check:
                    if stop_requested(session, control_endpoint, args.timeout):
                        return 0
                    next_control_check = now + max(args.control_interval, 0.1)

                # Drain any queued events with exponential backoff up to 30s.
                if retry_queue and now >= next_retry_at:
                    should_continue, drained_any = flush_retry_queue(
                        session, args.endpoint, retry_queue, args.timeout, args.verbose
                    )
                    if not should_continue:
                        return 0
                    if retry_queue:
                        retry_failures += 1
                        next_retry_at = now + min(2 ** min(retry_failures, 5), 30)
                    else:
                        if drained_any:
                            print("[bridge] retry queue drained", flush=True)
                        retry_failures = 0
                        queue_full_warned = False

                raw = ser.readline()
                if not raw:
                    if now - last_data_at > args.silence_timeout:
                        print(
                            f"[bridge] no serial data for {args.silence_timeout:.0f}s — "
                            "exiting so a supervisor can restart the bridge",
                            file=sys.stderr,
                        )
                        return 1
                    continue

                last_data_at = now
                line = raw.decode("utf-8", errors="ignore").strip()
                payload = parse_json_line(line)
                if payload is None:
                    continue

                event_name = payload.get("event")
                if event_name in DEBUG_EVENT_TYPES:
                    if debug_downsample == 0:
                        continue
                    count = debug_counts.get(event_name, 0)
                    debug_counts[event_name] = count + 1
                    if debug_downsample > 1 and count % debug_downsample != 0:
                        continue

                # Try the queue first if there's a backlog so events stay ordered.
                if retry_queue:
                    if len(retry_queue) == retry_queue.maxlen and not queue_full_warned:
                        print(
                            "[bridge] retry queue full, oldest events will be dropped",
                            flush=True,
                        )
                        queue_full_warned = True
                    retry_queue.append(payload)
                    continue

                should_continue, delivered = post_payload(
                    session,
                    args.endpoint,
                    payload,
                    args.timeout,
                    args.verbose,
                )
                if not delivered:
                    retry_queue.append(payload)
                    next_retry_at = now + 1
                if not should_continue:
                    return 0
    except serial.SerialException as exc:
        print(f"[bridge] serial error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n[bridge] stopped", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
