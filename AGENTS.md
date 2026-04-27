# IoT Demo Handoff

This repository is a local-first university demo for an Arduino Nano 33 BLE / Nano 33 BLE Sense style project.

It has 3 parts:

1. `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino`
2. `bridge/serial_to_http.py`
3. `web/` Next.js dashboard + API

This file is meant for both humans and coding agents. If you are joining the project, read this first.

## High-Level Flow

The board does not send HTTP directly. It prints JSON to USB Serial at `115200`, and the Python bridge forwards that JSON to the web app.

State machine on the board:

1. `WAITING_FOR_VOICE`
2. `WAITING_FOR_COLOUR`
3. `TRACKING_MOVEMENT`

Expected normal demo flow:

1. Board powers on and starts in `WAITING_FOR_VOICE`
2. TinyML hears the keyword `"start"`
3. Board emits `{"event":"voice_start"}`
4. Board moves to `WAITING_FOR_COLOUR`
5. Green is detected
6. Board emits `{"event":"colour_authenticated","colour":"green"}`
7. Board moves to `TRACKING_MOVEMENT`
8. Board continuously emits `movement` JSON with IMU values

## Current Repo Structure

- `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino`
  Main firmware. Contains the state machine, APDS colour reads, IMU sampling, and calls into the combined Edge Impulse layer.
- `arduino/libraries/combined_inferencing/`
  Local Arduino library for the combined Edge Impulse layer. It contains one SDK copy, merged model metadata/variables, and the three compiled models.
- `bridge/serial_to_http.py`
  Opens the Arduino serial port, reads JSON lines, ignores non-JSON, and POSTs valid JSON to the web app.
- `bridge/requirements.txt`
  Python dependencies: `pyserial`, `requests`
- `web/app/api/movement/route.js`
  `POST /api/movement`
- `web/app/api/latest/route.js`
  `GET /api/latest`
- `web/app/api/sessions/current/complete/route.js`
  `POST /api/sessions/current/complete`, used by the dashboard Stop button.
- `web/app/api/bridge/control/route.js`
  `GET /api/bridge/control`, polled by the Python bridge so the dashboard can stop the bridge process.
- `web/lib/eventStore.js`
  Postgres-backed event/session store with an in-memory fallback when `DATABASE_URL` is not set.
- `web/db/schema.sql`
  Idempotent Postgres schema for `sessions`, `events`, and `movement_samples`.
- `docker-compose.yml`
  Local/server deployment stack for the Next.js web app plus Postgres.
- `_update_server`
  Server update script: pulls latest code, rebuilds containers, and restarts the stack.
- `web/app/page.js`
  Polling dashboard UI with live latest event, recorded sessions, timeline, and movement chart.
- `web/package.json`
  Next.js app. `npm run dev` is pinned to `next dev --webpack` because Turbopack failed on this Mac.

## Important Design Notes

- With `DATABASE_URL`, the web app stores events and sessions in Postgres.
- Without `DATABASE_URL`, the web app falls back to in-memory storage for quick local development.
- Restarting the web app clears data only when using the in-memory fallback.
- The dashboard Stop button completes only authenticated sessions. If `voice_start` or `colour_authenticated` is missing, the session and its events are deleted.
- Stop also requests bridge shutdown. The bridge polls `/api/bridge/control` and exits when the server returns `stopBridge: true`.
- Restarting the Python bridge does not reset the Arduino.
- The Arduino state machine is one-way. Once it leaves `WAITING_FOR_VOICE`, it stays advanced until the board is reset or re-flashed.
- Only one process should own the serial port at a time.
  Do not run the bridge and Arduino Serial Monitor together.
- Do not include the three generated Edge Impulse `*_inferencing.h` headers directly in the sketch. They define conflicting global SDK symbols. Use `combined_inferencing.h`.

## Firmware Status

The firmware currently has these debug flags enabled:

- `EMIT_SETUP_STATUS = true`
- `EMIT_VOICE_DEBUG = true`
- `EMIT_COLOUR_DEBUG = true`

That means the board emits extra JSON events during testing:

- `setup_status`
- `voice_debug`
- `colour_debug`
- `voice_start`
- `colour_authenticated`
- `movement`

This is intentional. It makes debugging easier.

If you want a quieter demo later, disable the debug flags in the sketch and re-upload.

Voice startup false positives are guarded by `VOICE_ARM_DELAY_MS = 4000`. `VOICE_REQUIRED_STREAK = 1` for demo reliability, so one confident `"start"` detection after arming moves the board to colour.

## Edge Impulse Combined Model Requirements

The firmware now runs three Edge Impulse models from one local Arduino library:

- voice model `970121`: labels `start`, `unknown`
- colour model `970107`: labels `blue`, `green`, `other`, `red`
- movement model `928825`: labels `down`, `idle`, `left`, `right`, `up`

The original generated exports are kept as source references in `serhiisotskyi-project-1_inferencing/`, `pepstee-project-1_inferencing/`, and `joelshore-project-1-cpp-mcu-v1-impulse-#8/`. The Arduino sketch compiles from `arduino/libraries/combined_inferencing/` instead.

Important implementation details:

- The sketch includes `<combined_inferencing.h>`.
- `model_variables.h` exposes `voice_impulse_handle`, `colour_impulse_handle`, and `movement_impulse_handle`.
- Colour input maps APDS `r,g,b,clear` to Edge Impulse `ch1,ch2,ch3,ch4`.
- Movement input is 88 accelerometer samples at 44 Hz, converted from `g` to `m/s^2`.
- Do not regenerate this layer by pasting all three libraries together. Merge model variables and use explicit impulse handles.
- If Arduino reports undefined references such as `ei_malloc`, `ei_printf`, `arm_*`, `kiss_fftr_*`, or `tflite_learn_*`, it is finding the header but not compiling the library implementation files. Install/discover `combined_inferencing` as a real Arduino library.

## Setup From Scratch

### 1. Web app

From repo root:

```bash
cd web
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open:

- dashboard: `http://127.0.0.1:3000/`
- latest event API: `http://127.0.0.1:3000/api/latest`
- ingest API: `http://127.0.0.1:3000/api/movement`
- sessions API: `http://127.0.0.1:3000/api/sessions`
- complete current session API: `POST http://127.0.0.1:3000/api/sessions/current/complete`

Important:

- use `/` for the UI
- `/api/movement` is an API endpoint, not the dashboard page

### 2. Python bridge

From repo root:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r bridge/requirements.txt
```

Find the board port:

```bash
ls /dev/cu.*
```

Start the bridge:

```bash
python bridge/serial_to_http.py --port /dev/cu.usbmodemXXXX --endpoint http://127.0.0.1:3000/api/movement --verbose
```

Use the real port name shown by `ls /dev/cu.*`.

### Docker / server deployment

The deployable stack runs only the web app and Postgres. The Python bridge still runs on the laptop or machine connected to the Arduino and posts to the server URL.

First-time server setup:

```bash
git clone <repo-url> iot-demo
cd iot-demo
cp .env.example .env
chmod +x ./_update_server
./_update_server
```

Normal server update:

```bash
./_update_server
```

Manual Docker run:

```bash
docker compose up -d --build
docker compose logs -f web
```

Bridge pointing to the server:

```bash
python bridge/serial_to_http.py \
  --port /dev/cu.usbmodemXXXX \
  --endpoint http://SERVER_IP:3000/api/movement \
  --verbose
```

### 3. Arduino firmware

Open:

- `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino`

Required Arduino libraries:

- `Arduino_APDS9960`
- `Arduino_LSM9DS1`
- `PDM`
- `combined_inferencing`

The combined Edge Impulse code is stored in this repo at:

```text
arduino/libraries/combined_inferencing
```

For Arduino IDE, use one of these options:

1. Set Arduino IDE sketchbook location to this repo's `arduino/` folder, then restart Arduino IDE.
2. Or copy the library into the default sketchbook:

```bash
mkdir -p "$HOME/Documents/Arduino/libraries"
cp -R "arduino/libraries/combined_inferencing" "$HOME/Documents/Arduino/libraries/"
```

After copying or changing the sketchbook location, restart Arduino IDE before compiling.

Upload the sketch to the Nano 33 BLE / BLE Sense.

## How To Run The Demo

Recommended run order:

1. Start the web app
2. Start the Python bridge
3. Reset the board once so the state machine starts fresh
4. Watch the bridge output
5. Say `start`
6. Show green
7. Move the board

## What Good Output Looks Like

After a clean reset, the bridge should show something like:

```text
[bridge] POST setup_status -> 200 {"event":"setup_status","state":"WAITING_FOR_VOICE","voiceReady":true,"colourReady":true,"imuReady":true}
```

While waiting for voice:

```text
[bridge] POST voice_debug -> 200 {"event":"voice_debug","state":"WAITING_FOR_VOICE", ...}
```

After hearing `start`:

```text
[bridge] POST voice_start -> 200 {"event":"voice_start"}
```

Then, while waiting for colour:

```text
[bridge] POST colour_debug -> 200 {"event":"colour_debug","state":"WAITING_FOR_COLOUR", ...}
```

After seeing green:

```text
[bridge] POST colour_authenticated -> 200 {"event":"colour_authenticated","colour":"green"}
```

Then movement:

```text
[bridge] POST movement -> 200 {"event":"movement","ax":...,"ay":...,"az":...,"gx":...,"gy":...,"gz":...,"movementClass":"up","movementConfidence":0.91}
```

## Debugging Guide

### If the dashboard shows old data

The dashboard polls the API, so old values can stay visible until a new POST arrives. If Docker/Postgres is running, recorded sessions persist across browser and web-app restarts.

### If movement keeps arriving after Stop

The updated bridge should stop after the dashboard Stop button because it polls `/api/bridge/control`. If an old bridge script is running, it may continue posting; stop it with `Ctrl+C`, pull the latest code, and restart it.

### If Stop deletes the session

That is intentional when the run did not reach both authentication gates. The session is saved only after `voice_start` and `colour_authenticated` have both been recorded.

### If the bridge is silent

Likely causes:

- wrong serial port
- board disconnected
- sketch not uploaded
- serial port owned by Arduino Serial Monitor
- board is not printing JSON

### If the port disappears

The Nano serial device can change after reset or upload.

Check again:

```bash
ls /dev/cu.*
```

If no USB serial device appears:

- unplug and replug the board
- try another cable
- try another USB port
- double-press reset to enter bootloader mode

### If it jumps straight to `WAITING_FOR_COLOUR`

This usually means the board already advanced earlier and only the bridge was restarted.

Important:

- restarting the bridge does not reset the board
- reset the board to retest voice from the start

It can also mean the voice model false-triggered on startup noise.

### If you want to re-run from the beginning

Do this:

1. stop the bridge
2. reset the board once
3. wait for USB serial to reappear if needed
4. restart the bridge

### If you want to inspect board output directly

Stop the bridge first, then use Serial Monitor at `115200`.

Do not use Serial Monitor and the bridge at the same time.

## Board Reset Behavior

Nano 33 BLE / BLE Sense:

- single press reset: restart the currently flashed sketch
- double press reset: enter bootloader mode

Single reset is what you want for restarting the demo state machine.

## Current Known Caveats

- The state machine is one-way and does not reset itself.
- Voice startup false positives are still possible.
- Colour and movement now depend on the teammate-trained TinyML models, so wrong feature order or training units will show as low confidence.
- The web app stores persistent sessions only when `DATABASE_URL` is configured. Plain `npm run dev` without Postgres uses in-memory fallback.
- The sketch has debug output enabled for development.

## Useful Manual Tests

Test the web app without the board:

```bash
curl -X POST http://127.0.0.1:3000/api/movement \
  -H 'Content-Type: application/json' \
  -d '{"event":"movement","ax":0.01,"ay":-0.02,"az":0.98,"gx":1.2,"gy":0.4,"gz":-0.1,"direction":"down"}'
```

Check latest event:

```bash
curl http://127.0.0.1:3000/api/latest
```

Check recorded sessions:

```bash
curl http://127.0.0.1:3000/api/sessions
```

Complete the active session manually:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions/current/complete
```

Check whether the bridge has been asked to stop:

```bash
curl http://127.0.0.1:3000/api/bridge/control
```

## For Future Agents

If you are modifying this repo:

1. Read this file first
2. Then inspect the firmware sketch
3. Then inspect the bridge
4. Then inspect the web app

Important operational assumptions:

- local serial bridge is required
- the board does not do Wi-Fi or direct HTTP
- the combined Edge Impulse layer is intentional; do not replace it with three direct generated-library includes
- Docker/Postgres is the deployable persistent path; in-memory storage is only a local fallback
- current debug events are intentional and may dominate the dashboard until disabled
