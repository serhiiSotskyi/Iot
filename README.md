# Warehouse Sensor Node

A three-tier IoT demo that turns an Arduino Nano 33 BLE / Nano 33 BLE
Sense into a warehouse pick assistant. The board runs three local Edge
Impulse models for voice keyword spotting, colour authentication, and
IMU motion classification. It prints JSON over USB Serial to a Python
bridge, and the bridge forwards those events to a Next.js + Postgres
dashboard for live monitoring and pick-session replay.

## What It Does

The normal manual-test flow is:

1. The operator resets the board and waits for `setup_status`.
2. The operator says **Start**.
3. The dashboard shows `"Start" voice authentication detected`.
4. The operator presents a green package tag/card.
5. The dashboard shows `Green color detected.`
6. The operator moves the board up, down, left, or right.
7. The dashboard shows `Detecting movement.`
8. The operator clicks **End pick session** and replays the completed
   session from the dashboard.

The embedded pattern is intentional: the MCU does the inference, a
trusted USB-connected gateway does the network I/O, and the server owns
persistence, authentication, and UI.

## Hardware

- Arduino Nano 33 BLE or Nano 33 BLE Sense
- USB data cable, not a charge-only cable
- A green object or card for the colour-authentication gate
- Laptop or small host with Docker Desktop and Python 3.10+
- Arduino IDE 2.x for flashing the firmware

## Repository Layout

```text
arduino/voice_colour_motion_demo/        firmware sketch and state machine
arduino/libraries/combined_inferencing/  one Edge Impulse SDK with three impulse handles
bridge/serial_to_http.py                 USB-serial to HTTP bridge
bridge/requirements.txt                  Python bridge dependencies
web/                                     Next.js dashboard and API
web/db/schema.sql                        Postgres schema
tests/bridge/                            bridge unit tests
reports/                                 Word documents for setup, video links, and contribution evidence
_update_server                           pull/build/restart helper for an already cloned deployment
verify.sh                                live API/auth verification script
```

The combined firmware library contains all three compiled models. The
current main branch also keeps these original Edge Impulse exports as
model evidence:

```text
serhiisotskyi-project-1_inferencing/          voice model, project 970121
joelshore-project-1-cpp-mcu-v1-impulse-#8/    movement model, project 928825
```

The firmware compiles against `arduino/libraries/combined_inferencing/`,
not directly against individual generated export folders. Do not add
those export folders as separate Arduino libraries for the main sketch,
because the generated SDK symbols collide.

## Quick Start

For a fuller step-by-step guide, use
`reports/setup_and_manual_testing_guide.docx`. The commands below are the
short version for macOS/Linux from the repository root.

### 1. Configure `.env`

```bash
cp .env.example .env
openssl rand -hex 32
```

Edit `.env` and fill these values:

```env
WEB_PORT=3001
POSTGRES_HOST_PORT=5434
DASHBOARD_PASSWORD=choose-a-demo-password
SESSION_SECRET=<paste openssl rand -hex 32 output>
BRIDGE_API_TOKEN=<paste openssl rand -hex 32 output>
ADMIN_API_TOKEN=<paste openssl rand -hex 32 output>
```

`BRIDGE_API_TOKEN` and `ADMIN_API_TOKEN` are required by
`docker-compose.yml`. `DASHBOARD_PASSWORD` and `SESSION_SECRET` enable
the dashboard login flow used during the demo.

### 2. Start Dashboard and Database

```bash
docker compose up -d --build
docker compose ps
```

With `WEB_PORT=3001`, open:

```text
http://localhost:3001/
```

Sign in with the value from `DASHBOARD_PASSWORD`.

Useful logs:

```bash
docker compose logs -f web
docker compose logs -f postgres
```

### 3. Flash the Firmware

Open this sketch in Arduino IDE:

```text
arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino
```

Install/select:

- Arduino Nano 33 BLE or Nano 33 BLE Sense board package
- `Arduino_APDS9960`
- `Arduino_LSM9DS1`
- `PDM`
- `combined_inferencing` from `arduino/libraries/combined_inferencing/`

For Arduino IDE, either set the sketchbook location to this repository's
`arduino/` folder, or copy the combined library into the normal Arduino
libraries folder:

```bash
mkdir -p "$HOME/Documents/Arduino/libraries"
cp -R arduino/libraries/combined_inferencing "$HOME/Documents/Arduino/libraries/"
```

Restart Arduino IDE after changing library locations, then upload the
sketch. Close Serial Monitor before running the Python bridge, because
only one process can own the serial port.

### 4. Start the Python Bridge

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r bridge/requirements.txt
```

Find the board:

```bash
ls /dev/cu.usbmodem*
```

Export the bridge token and start the bridge. Replace the port if your
board appears under a different name.

```bash
export BRIDGE_API_TOKEN="$(grep '^BRIDGE_API_TOKEN=' .env | cut -d= -f2-)"

python bridge/serial_to_http.py \
  --port /dev/cu.usbmodem1201 \
  --endpoint http://localhost:3001/api/movement \
  --api-token "$BRIDGE_API_TOKEN" \
  --verbose
```

For a clean run, start the bridge first, then single-press reset the
Arduino. The first important bridge line should be similar to:

```text
[bridge] POST setup_status -> 200
```

Optional debug forwarding:

```bash
python bridge/serial_to_http.py \
  --port /dev/cu.usbmodem1201 \
  --endpoint http://localhost:3001/api/movement \
  --api-token "$BRIDGE_API_TOKEN" \
  --debug-downsample 1 \
  --verbose
```

By default the bridge drops `voice_debug` and `colour_debug` events so the
dashboard and database stay focused on functional demo events.

### 5. Walk the Demo

1. Reset the board and wait for `POST setup_status -> 200`.
2. Wait for the 4-second arm delay, then say **Start** clearly.
3. Confirm the dashboard shows `"Start" voice authentication detected`.
4. Hold a green object close to the APDS-9960 colour sensor.
5. Confirm the dashboard shows `Green color detected.`
6. Move the board up, down, left, or right.
7. Confirm the dashboard shows `Detecting movement.`
8. Click **End pick session**.
9. Confirm the bridge prints `stop requested by server` and exits.
10. Replay the session from the recent pick sessions list.

## API Routes

The current web app exposes these routes:

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | Dashboard password login |
| `POST /api/auth/logout` | Dashboard logout |
| `POST /api/movement` | Bridge event ingest, protected by `BRIDGE_API_TOKEN` |
| `GET /api/bridge/control` | Bridge stop polling, protected by `BRIDGE_API_TOKEN` |
| `GET /api/latest` | Latest event for the authenticated dashboard |
| `GET /api/sessions` | Recorded sessions for the authenticated dashboard |
| `GET /api/sessions/[id]` | One recorded session replay |
| `POST /api/sessions/current/complete` | End the active pick session; accepts dashboard cookie or `ADMIN_API_TOKEN` |

## Reports and Submission Documents

The `docs/` folder is not part of the current main branch. The tracked
submission/supporting documents are in `reports/`:

| File | Purpose |
|---|---|
| `reports/setup_and_manual_testing_guide.docx` | Full setup and manual testing runbook from a fresh clone |
| `reports/iot_project_video_links.docx` | Google Drive link for the full walkthrough and project song videos |
| `reports/joel_section_iot.docx` | Joel's contribution write-up |

## Configuration

`.env` is gitignored and read by Docker Compose. See `.env.example` for
the complete list.

| Variable | Purpose |
|---|---|
| `WEB_PORT` | Host port for the dashboard, for example `3001` |
| `POSTGRES_HOST_PORT` | Host port for Postgres, for example `5434` |
| `POSTGRES_PASSWORD` | Postgres password for the local Docker database |
| `DASHBOARD_PASSWORD` | Operator login password |
| `SESSION_SECRET` | HMAC key for the signed `iot_session` cookie; use at least 16 characters |
| `BRIDGE_API_TOKEN` | Bearer token for `/api/movement` and `/api/bridge/control` |
| `ADMIN_API_TOKEN` | Bearer token accepted by the Stop endpoint for non-browser calls |
| `INGEST_RATE_LIMIT_PER_MIN` | Per-IP ingest rate limit; `0` disables it |

## Testing and Verification

Run the live API/auth verification after Docker is running:

```bash
./verify.sh http://localhost:3001
```

The script reads `DASHBOARD_PASSWORD`, `SESSION_SECRET`,
`BRIDGE_API_TOKEN`, and `ADMIN_API_TOKEN` from `.env`. It checks login,
cookie auth, bridge bearer-token auth, Stop endpoint auth, and read-only
dashboard API protection.

Run bridge unit tests:

```bash
python -m unittest tests.bridge.test_serial_to_http -v
```

These tests cover JSON-line parsing, control endpoint inference, and
colour-auth endpoint selection without needing a real Arduino or web
server.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Connection refused` for `localhost:3001` | Docker web container is not running yet or `WEB_PORT` is different | Run `docker compose ps`; wait until `iot-demo-web` is healthy/running |
| `401 Unauthorized` from the bridge | Missing or wrong `BRIDGE_API_TOKEN` | Re-export the token from `.env` and pass `--api-token "$BRIDGE_API_TOKEN"` |
| `stop requested by server` after `voice_start` or `colour_debug` | Server is waiting for a fresh `setup_status` after a previous stop | Start the bridge, single-press reset the board, then wait for `setup_status` before saying Start |
| `Device not configured` | USB device changed, disconnected, or reset into another mode | Unplug/replug, run `ls /dev/cu.usbmodem*`, restart bridge with the new port |
| No serial data for 60s | Wrong port, sketch not uploaded, board silent, or Serial Monitor owns the port | Close Serial Monitor, verify sketch upload, reset board, restart bridge |
| Board jumps straight to colour or movement | Restarting the bridge did not reset the Arduino state machine | Single-press reset the board while the bridge is listening |
| Bridge retry traceback about `flush_retry_queue` arguments | Current retry path can hit an argument mismatch if the API is down while queued events flush | Start Docker first and wait healthy before starting the bridge |

## Deployment Helper

If the repository is already cloned on a server or demo laptop,
`_update_server` pulls the latest `main`, rebuilds the Docker image, and
restarts the stack:

```bash
chmod +x ./_update_server
./_update_server
```

It still requires `.env` to contain `BRIDGE_API_TOKEN` and
`ADMIN_API_TOKEN`.

## Current Scope

This is a controlled university demo intended for a trusted LAN and a
single operator dashboard. The board does not use Wi-Fi or direct HTTP.
The Python bridge is required because the board sends newline-delimited
JSON over USB Serial at `115200`.
