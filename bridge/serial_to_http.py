#!/usr/bin/env python3
"""Serial-to-HTTP bridge for the Nano 33 BLE demo."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

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
) -> None:
    try:
        response = session.post(endpoint, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        print(f"[bridge] POST failed: {exc}", flush=True)
        return

    if 200 <= response.status_code < 300:
        event_name = payload.get("event", "unknown")
        if verbose:
            compact = json.dumps(payload, separators=(",", ":"))
            print(f"[bridge] POST {event_name} -> {response.status_code} {compact}", flush=True)
        else:
            print(f"[bridge] POST {event_name} -> {response.status_code}", flush=True)
        return

    body = response.text.strip().replace("\n", " ")
    print(f"[bridge] HTTP {response.status_code}: {body[:200]}", flush=True)


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

    try:
        with serial.Serial(args.port, args.baud, timeout=1) as ser:
            while True:
                raw = ser.readline()
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="ignore").strip()
                payload = parse_json_line(line)
                if payload is None:
                    continue

                post_payload(session, args.endpoint, payload, args.timeout, args.verbose)
    except serial.SerialException as exc:
        print(f"[bridge] serial error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n[bridge] stopped", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
