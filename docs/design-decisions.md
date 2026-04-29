# Design Decisions

Architectural choices that are not obvious from reading the code, recorded with the trade-offs each one accepts.

---

## 1. HTTP POST for telemetry, not MQTT

This is the decision most worth justifying academically, because MQTT is the textbook answer for IoT telemetry and the choice here goes the other way.

### Context

The system has a single sensor node, tethered by USB to one gateway, sending JSON events at peak rates of ~44 Hz (movement) but typically 2–4 Hz (debug telemetry). The application server stores every event and surfaces it through a polling dashboard. The deployment target is a single-tenant warehouse network behind a reverse proxy.

### Options considered

| Property | HTTP POST (chosen) | MQTT 3.1.1 / 5 |
|---|---|---|
| Topology | Point-to-point | Pub/sub via broker |
| Delivery semantics | Per-request status code; client retries | QoS 0/1/2 with broker buffering |
| Server-side fan-out | One consumer (the API route) | Many subscribers possible |
| Auth | TLS + bearer token | TLS + username/password or client certs |
| Persistence model | Server controls | Broker can retain last value, queue offline |
| Bytes per event | Higher (HTTP headers ≈ 200–400 B) | Lower (MQTT fixed header ≈ 2–5 B) |
| Bidirectional control | Polling endpoint or SSE/WebSocket | Native (subscribe to a control topic) |
| Operational footprint | Just the web app | Web app + broker (Mosquitto, EMQX, …) |
| Debugging tooling | `curl`, browser dev tools, any HTTP client | `mosquitto_sub`, dedicated MQTT clients |
| Familiarity for assessors | Universal | Domain-specific |

### Decision

**HTTP POST.** Three reasons drive this in this specific system:

1. **One device, one consumer, one direction.** MQTT's central value proposition is fan-out and decoupling between many publishers and many subscribers. There is exactly one publisher (the bridge) and one subscriber (the API route). The pub/sub indirection adds an operational dependency (a broker) without buying anything that this workload needs.

2. **Postgres is already the source of truth.** A pick session has a clearly bounded lifecycle and the dashboard does *random-access replay* (timeline scrubbing, event-by-event inspection) — not real-time stream consumption. A relational store is the natural fit; a broker's retained-message and last-will features would be unused.

3. **The bridge is the right place for buffering.** Because the bridge is a USB-tethered process on a host with disk and memory, an in-memory retry queue with exponential backoff is sufficient to ride out transient web-app outages. MQTT QoS 1/2 buffering on the broker side would solve the same problem, but at the cost of running, monitoring, and authenticating a broker.

### Trade-offs accepted

- **Higher per-event byte cost.** ~250–400 bytes of HTTP overhead per event versus ~5–20 for MQTT. At 44 Hz this is roughly 15 KB/s of overhead, which is negligible on a LAN but would matter on a cellular link.
- **No native control channel.** The bridge has to *poll* `/api/bridge/control` for stop signals, instead of subscribing to a topic. The current 1 s polling interval is fine, but it is more chatter than an MQTT subscribe-and-wait would generate.
- **No built-in fan-out.** If a second consumer is later needed (e.g. an analytics pipeline reading every event), it would have to read from Postgres or the API rather than subscribing to a topic.

### When the decision should be revisited

Switch to MQTT if any of these become true:
- More than one device feeds the same dashboard.
- The link between the gateway and the server becomes intermittent (e.g. cellular, mesh).
- A second consumer needs the *same* events without re-querying the database.
- Per-event bandwidth becomes a cost driver.

Until then, HTTP POST is the lower-complexity, higher-introspectability choice.

---

## 2. USB-serial bridge instead of direct Wi-Fi from the MCU

The Nano 33 BLE Sense has a Bluetooth radio but no Wi-Fi and no IP stack on board. Three paths were considered:

1. Add a Wi-Fi shield or use a different board (e.g. Nano 33 IoT, ESP32) and have the device speak HTTPS directly.
2. Use BLE to hand off events to a phone or laptop running a relay.
3. **Tether by USB to a host running a Python bridge.** *(Chosen.)*

### Why option 3

- **No on-device TLS code path.** Embedded TLS stacks (mbedTLS, BearSSL) work but eat flash and RAM that the three Edge Impulse models already need. Pushing security to the gateway sidesteps this entirely.
- **One place to enforce policy.** Auth, rate limiting, payload validation, and retry are all on the bridge / server, not duplicated in firmware that takes a re-flash to update.
- **Simpler operator experience for a demo.** Plug in, run two commands. No onboarding flow for joining the board to a Wi-Fi network.
- **Honest about the constraint.** The board doesn't have Wi-Fi. Pretending otherwise via a shield to look more "IoT" would have been cargo-culting the architecture.

### Trade-off

- The system can't be *deployed* in places where the board can't be tethered (e.g. inside a mobile pick cart). For a real warehouse rollout this would push to ESP32 + MQTT or to LoRaWAN, depending on density.

---

## 3. Three on-device models, served through one combined Edge Impulse library

Each Edge Impulse export ships its own copy of the SDK with global symbols (`ei_malloc`, `ei_printf`, `arm_*`, `kiss_fftr_*`). Including all three exports directly in one sketch causes link-time symbol collisions.

### Decision

A single `arduino/libraries/combined_inferencing/` library that bundles **one** SDK copy and three sets of model variables, exposing three impulse handles (`voice_impulse_handle`, `colour_impulse_handle`, `movement_impulse_handle`). The firmware includes only `<combined_inferencing.h>`.

### Why this is non-obvious

The "obvious" thing to do is to keep all three generated libraries and `#include` them — and that's exactly what fails. The combined library is the only working option short of running each model on a separate MCU.

### Trade-off

Re-training any one model requires regenerating the combined library, not just dropping in a new generated export. This is friction worth paying for the simpler firmware.

---

## 4. In-memory fallback for the event store, gated to development only

`web/lib/eventStore.js` supports running without `DATABASE_URL` set, holding events in module-scope memory. This is convenient for `npm run dev` on a laptop with no Postgres around.

### Decision

Keep the in-memory path, but throw at request time if `NODE_ENV === "production"` and `DATABASE_URL` is unset (`assertMemoryFallbackAllowed()`).

### Why request-time, not module-load

Next.js's `next build` step imports route modules without the runtime environment present. A module-load throw would break the Docker build. The check fires on the first DB-touching request instead, which is sufficient because a production deployment that's missing `DATABASE_URL` will fail loudly within seconds of the first incoming event.

### Trade-off

- The in-memory fallback isn't safe across Next.js module-instance reloads in development. We accept that because it is a development-only escape hatch; production requires `DATABASE_URL`.

---

## 5. Polling, not Server-Sent Events / WebSocket, for the dashboard

The dashboard polls `/api/latest` every 500 ms and `/api/sessions` every 2000 ms.

### Decision

Polling, for now.

### Why

- Single dashboard user, on the same LAN, with sub-second tolerance for "live" updates.
- HTTP polling is observable in the browser dev tools and uses no special infrastructure.
- SSE would be a strictly better fit and would cut server load by ~99 %, but it is a larger refactor than the demo scope justifies.

### When this should change

When a second simultaneous dashboard viewer is plausible, switch to SSE off the ingest write path. WebSockets would be over-engineered: the channel is one-way (server to browser).

---

## 6. The bridge drops `voice_debug` and `colour_debug` by default

The firmware emits `voice_debug` at 2 Hz while waiting for the keyword and `colour_debug` at 2 Hz while waiting for the package tag. Multiplied across a typical 30-minute demo this is several thousand uninteresting database rows.

### Decision

The bridge default for `--debug-downsample` is `0` (drop both event types entirely). The full set of normal functional events is `setup_status`, `voice_start`, `colour_authenticated`, and `movement`; `debug` output appears only when firmware debug logging is enabled. Set `BRIDGE_DEBUG_DOWNSAMPLE=1` to forward every debug sample, or `=4` to keep one-in-four for live tuning.

### Trade-off

- Less data available for offline debugging of voice or colour confidence over time.
- Easy to recover by raising the env var; no code change needed.
