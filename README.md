# Warehouse Sensor Node

A three-tier IoT system that turns an Arduino Nano 33 BLE Sense into a
warehouse pick assistant. The board runs three on-device Edge Impulse
models — voice keyword spotting, package-tag colour classification, and
IMU motion classification — and streams classification results over USB
serial to a Python bridge, which forwards them to a Next.js + Postgres
dashboard for live monitoring and pick-session replay.

## What it does

An operator approaches a workstation, says **"start"** to arm the
scanner, presents a green package tag for verification, then handles the
package while the system records the handling motion direction
(up / down / left / right / idle) until the pick session is ended from
the dashboard.

This is the realistic embedded-ML pattern: the constrained MCU does the
inference, a trusted gateway does the I/O, and a server owns persistence
and UI.

## Hardware

- Arduino Nano 33 BLE Sense (nRF52840, Cortex-M4F @ 64 MHz, 1 MB flash, 256 KB RAM)
- USB-A → micro-USB cable
- A green object to act as the package tag
- A laptop or single-board computer with Docker and Python 3.10+

## Layout

```
arduino/voice_colour_motion_demo/   firmware sketch (state machine + 3 model invocations)
arduino/libraries/combined_inferencing/  one Edge Impulse SDK + 3 impulse handles
bridge/serial_to_http.py            USB-serial → HTTP bridge with retry queue
web/                                Next.js dashboard + Postgres-backed event store
docs/                               architecture, design decisions, threat model, model metrics
docs/diagrams/                      four .drawio diagrams for the report
```

## Run it

### 1. Bring up the dashboard

```bash
cp .env.example .env       # then fill in DASHBOARD_PASSWORD and SESSION_SECRET if you want auth
docker compose up -d --build
```

If host port 3000 or 5432 is already in use:

```bash
WEB_PORT=3001 POSTGRES_HOST_PORT=5434 docker compose up -d --build
```

The dashboard is at <http://localhost:3000> (or whatever `WEB_PORT` you set).
If `DASHBOARD_PASSWORD` is set in `.env`, you'll be redirected to `/login`.

### 2. Flash the firmware

Open `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino` in
Arduino IDE 2.x. Make sure `arduino/libraries/combined_inferencing/`
is on your sketchbook libraries path. Select **Arduino Nano 33 BLE** as
the board and upload.

> **Do not** add the three top-level Edge Impulse export trees as
> separate Arduino libraries — they'd collide on shared SDK symbols.
> The combined library bundles all three models against one SDK copy.
> See `docs/design-decisions.md` § 3.

### 3. Start the bridge

```bash
python -m venv .venv && source .venv/bin/activate
pip install pyserial requests
python bridge/serial_to_http.py \
    --port /dev/ttyACM0 \
    --url http://localhost:3000/api/movement \
    --ingest-token "$(grep ^INGEST_TOKEN .env | cut -d= -f2)"
```

Adjust `--port` to your serial device. On Linux the user must be in the
`dialout` group to read `/dev/ttyACM*`.

### 4. Walk the demo

1. Reset the board. Watch the dashboard live status update to
   *"Sensor node booted"* — confirms `setup_status` arrived.
2. Wait for the 4-second arm delay, then say **"start"**.
   The scanner status flips to *"Operator scan command armed"*.
3. Hold a green object in front of the APDS-9960 sensor.
   Status flips to *"Package tag verified"*.
4. Move the board up, down, left, or right — the dashboard shows the
   motion class and confidence in real time.
5. Press **End pick session** on the dashboard. The bridge exits, the
   session is saved as completed, and you can replay it from the list.

## Documentation

The narrative documents in `docs/` are written for the report; they
explain *why* the system is shaped the way it is, not what each line of
code does.

| File | Topic |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Topology mapped to the IoT World Forum 7-layer reference model |
| [`docs/design-decisions.md`](docs/design-decisions.md) | HTTP vs MQTT, USB bridge vs Wi-Fi, combined library vs three libraries, polling vs SSE, debug-event drop |
| [`docs/threat-model.md`](docs/threat-model.md) | DFD-driven STRIDE-per-element analysis with CVSS v3.1 base scores; methodology section justifies STRIDE + CVSS over DREAD |
| [`docs/model-metrics.md`](docs/model-metrics.md) | Template for the three Edge Impulse models — fill in from EI Studio before submission |
| `docs/diagrams/01-system-architecture.drawio` | System topology with IoT-layer colour bands |
| `docs/diagrams/02-data-flow-diagram.drawio` | DFD with trust boundaries — backs up the threat model |
| `docs/diagrams/03-firmware-state-machine.drawio` | Boot → arm → voice → colour → motion gates |
| `docs/diagrams/04-pick-session-sequence.drawio` | End-to-end sequence across all six participants |

`AGENTS.md` is a longer handoff document covering implementation details
that future contributors (human or AI) need to know.

## Configuration

`.env` (gitignored) holds runtime secrets and is read by Docker Compose.
See `.env.example` for the full list. Highlights:

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Postgres password — replace the default before any deployment |
| `INGEST_TOKEN` | Bearer token required on `/api/movement` if set |
| `INGEST_RATE_LIMIT_PER_MIN` | Per-IP rate limit on ingest (0 = off) |
| `DASHBOARD_PASSWORD` | Operator login password — when set, the dashboard is gated |
| `SESSION_SECRET` | HMAC key for the session cookie. Generate with `openssl rand -hex 32` |
| `POSTGRES_HOST_PORT` | Override if 5432 is busy on your host |
| `WEB_PORT` | Override if 3000 is busy on your host |

## Status

This is a university IoT project, intentionally scoped for a controlled
lab demo on a trusted LAN. The threat model in `docs/threat-model.md`
records what is and isn't mitigated, with explicit out-of-scope items
(TLS termination, per-operator identity, firmware code-signing) listed
as recommended next steps.
