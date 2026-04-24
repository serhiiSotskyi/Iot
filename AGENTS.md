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
  Main firmware. Contains the state machine, APDS colour logic, IMU streaming, and Edge Impulse integration points.
- `bridge/serial_to_http.py`
  Opens the Arduino serial port, reads JSON lines, ignores non-JSON, and POSTs valid JSON to the web app.
- `bridge/requirements.txt`
  Python dependencies: `pyserial`, `requests`
- `web/app/api/movement/route.js`
  `POST /api/movement`
- `web/app/api/latest/route.js`
  `GET /api/latest`
- `web/lib/latestEventStore.js`
  In-memory latest-event store
- `web/app/page.js`
  Polling dashboard UI
- `web/package.json`
  Next.js app. `npm run dev` is pinned to `next dev --webpack` because Turbopack failed on this Mac.

## Important Design Notes

- The web app stores only the latest event in memory.
- Restarting the web app clears the latest event.
- Restarting the Python bridge does not reset the Arduino.
- The Arduino state machine is one-way. Once it leaves `WAITING_FOR_VOICE`, it stays advanced until the board is reset or re-flashed.
- Only one process should own the serial port at a time.
  Do not run the bridge and Arduino Serial Monitor together.

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

## Edge Impulse / Voice Module Requirements

The voice module depends on an exported Edge Impulse Arduino library/header.

Current sketch expectation:

- `VOICE_MODULE_ENABLED` should be `1`
- the project must be able to include:
  - `PDM.h`
  - `serhiisotskyi-project-1_inferencing.h`

If the voice model or library is missing, the board will not behave correctly.

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

### 3. Arduino firmware

Open:

- `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino`

Required Arduino libraries:

- `Arduino_APDS9960`
- `Arduino_LSM9DS1`
- `PDM`
- the exported Edge Impulse library for the trained voice model

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
[bridge] POST movement -> 200 {"event":"movement","ax":...,"ay":...,"az":...,"gx":...,"gy":...,"gz":...}
```

## Debugging Guide

### If the dashboard shows old data

The web app only stores the latest event in memory. Old values can stay visible until a new POST arrives.

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
- The web app only shows the latest event, not an event history.
- The latest-event store is process memory only and is not persistent.
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

## For Future Agents

If you are modifying this repo:

1. Read this file first
2. Then inspect the firmware sketch
3. Then inspect the bridge
4. Then inspect the web app

Important operational assumptions:

- local serial bridge is required
- the board does not do Wi-Fi or direct HTTP
- dashboard data is in-memory only
- current debug events are intentional and may dominate the dashboard until disabled
