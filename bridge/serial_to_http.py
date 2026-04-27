#!/usr/bin/env python3
"""Serial-to-HTTP bridge for the Nano 33 BLE demo."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any
from urllib.parse import urlparse, urlunparse

import requests
import serial


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
        "--timeout",
        type=float,
        default=float(os.getenv("HTTP_TIMEOUT", "5")),
        help="HTTP timeout in seconds. Default: 5",
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
) -> bool:
    try:
        response = session.post(endpoint, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        print(f"[bridge] POST failed: {exc}", flush=True)
        return True

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
            return False

        return True

    body = response.text.strip().replace("\n", " ")
    print(f"[bridge] HTTP {response.status_code}: {body[:200]}", flush=True)
    return True


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
    control_endpoint = args.control_endpoint or infer_control_endpoint(args.endpoint)
    next_control_check = 0.0
    if control_endpoint:
        print(f"[bridge] polling control endpoint {control_endpoint}", flush=True)

    try:
        with serial.Serial(args.port, args.baud, timeout=1) as ser:
            while True:
                now = time.monotonic()
                if control_endpoint and now >= next_control_check:
                    if stop_requested(session, control_endpoint, args.timeout):
                        return 0
                    next_control_check = now + max(args.control_interval, 0.1)

                raw = ser.readline()
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="ignore").strip()
                payload = parse_json_line(line)
                if payload is None:
                    continue

                should_continue = post_payload(
                    session,
                    args.endpoint,
                    payload,
                    args.timeout,
                    args.verbose,
                )
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
