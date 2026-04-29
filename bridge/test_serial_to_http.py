"""Unit tests for the pure-logic parts of serial_to_http.

Run from the repo root:

    python -m unittest bridge.test_serial_to_http

These tests do not open a serial port, do not start an HTTP session, and
do not need any of the runtime dependencies — only the standard library.
They cover the input validation and URL inference paths that determine
whether a malformed line is accepted, a non-object payload is dropped,
or the control endpoint is inferred from a misshapen ingest URL.
"""

import os
import sys
import types
import unittest

# Stub the runtime dependencies (pyserial, requests) before importing the
# module under test. The pure functions tested here do not call into these
# libraries, so the stubs only need to exist as importable names. This lets
# the tests run on a clean Python install without `pip install pyserial requests`.
for stub_name in ("serial", "requests"):
    if stub_name not in sys.modules:
        sys.modules[stub_name] = types.ModuleType(stub_name)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serial_to_http import infer_control_endpoint, parse_json_line, select_endpoint  # noqa: E402


class TestParseJsonLine(unittest.TestCase):
    def test_empty_line_returns_none(self):
        self.assertIsNone(parse_json_line(""))
        self.assertIsNone(parse_json_line("   \n"))

    def test_non_brace_prefix_returns_none(self):
        # Boot banners and Edge Impulse log lines must not crash the bridge.
        self.assertIsNone(parse_json_line("Edge Impulse Inferencing v1.66.4"))
        self.assertIsNone(parse_json_line("Predictions: voice 0.92"))

    def test_invalid_json_returns_none(self):
        self.assertIsNone(parse_json_line("{not valid json"))
        self.assertIsNone(parse_json_line('{"event":"setup_status",}'))

    def test_non_object_json_returns_none(self):
        self.assertIsNone(parse_json_line("[1, 2, 3]"))
        self.assertIsNone(parse_json_line('"just a string"'))
        self.assertIsNone(parse_json_line("42"))

    def test_valid_object_returns_dict(self):
        result = parse_json_line('{"event":"setup_status","voiceReady":true}')
        self.assertEqual(result, {"event": "setup_status", "voiceReady": True})

    def test_strips_surrounding_whitespace(self):
        result = parse_json_line('  {"event":"movement","ax":0.1}\r\n')
        self.assertEqual(result, {"event": "movement", "ax": 0.1})


class TestInferControlEndpoint(unittest.TestCase):
    def test_basic_url(self):
        self.assertEqual(
            infer_control_endpoint("http://localhost:3000/api/movement"),
            "http://localhost:3000/api/bridge/control",
        )

    def test_https_url(self):
        self.assertEqual(
            infer_control_endpoint("https://demo.example.com/api/movement"),
            "https://demo.example.com/api/bridge/control",
        )

    def test_url_with_query_string_is_dropped(self):
        # A query string on the ingest URL must not contaminate the control
        # endpoint — that would silently break bridge↔server communication.
        self.assertEqual(
            infer_control_endpoint("http://localhost:3000/api/movement?session=abc"),
            "http://localhost:3000/api/bridge/control",
        )

    def test_invalid_url_returns_none(self):
        self.assertIsNone(infer_control_endpoint("not-a-url"))
        self.assertIsNone(infer_control_endpoint(""))


class TestSelectEndpoint(unittest.TestCase):
    def test_colour_authenticated_uses_auth_endpoint_when_present(self):
        self.assertEqual(
            select_endpoint(
                {"event": "colour_authenticated"},
                "http://localhost:3000/api/movement",
                "http://localhost:3000/api/authorize",
            ),
            "http://localhost:3000/api/authorize",
        )

    def test_colour_authenticated_falls_back_to_default_endpoint(self):
        self.assertEqual(
            select_endpoint(
                {"event": "colour_authenticated"},
                "http://localhost:3000/api/movement",
                None,
            ),
            "http://localhost:3000/api/movement",
        )

    def test_non_auth_events_keep_default_endpoint(self):
        self.assertEqual(
            select_endpoint(
                {"event": "movement"},
                "http://localhost:3000/api/movement",
                "http://localhost:3000/api/authorize",
            ),
            "http://localhost:3000/api/movement",
        )


if __name__ == "__main__":
    unittest.main()
