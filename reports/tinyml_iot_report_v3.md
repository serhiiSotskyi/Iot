# TinyML IoT Demo: Technical and Business Report

**Voice Recognition, Movement Detection, and Group Integration Report**

| **Field** | **Value** |
|---|---|
| Students | Serhii Sotskyi · Joel Shore (with colour-model contribution from group member Artiom Gutu, EI handle `pepstee`) |
| Module | Internet of Things / Cloud Computing Coursework |
| Report split | Personal section (Serhii): voice recognition TinyML. Personal section (Joel): movement detection TinyML. Group section: three-model firmware integration (including Artiom's colour model), bridge, dashboard, Docker, and security. |
| Date | 29 April 2026 |

> **Project scope:** Arduino Nano 33 BLE Sense firmware runs three TinyML models for voice, colour authentication, and movement recognition. A Python bridge forwards serial JSON to a Next.js dashboard with Postgres-backed session recording, Docker deployment, and STRIDE-informed API security.

---

## Executive Summary

This report describes a local-first TinyML Internet of Things demonstration that combines edge inference, cloud-style persistence, and a web dashboard into one demonstrable end-to-end workflow. The system uses an Arduino Nano 33 BLE Sense to detect the spoken keyword *start*, authenticate a green colour target, and then classify board movement direction. The board does not connect to the network directly. Instead, it prints structured JSON over USB serial at 115200 baud, and a Python bridge forwards each valid event to a Next.js API. The API stores sessions in PostgreSQL when Docker Compose is used, while the dashboard shows the latest event, recorded session state, authentication progress, and a movement replay chart.

The business value is a low-cost, explainable proof of concept for edge sensing workflows. Voice and colour gates make the system behave like an authenticated interaction rather than a raw sensor logger, while movement recognition produces useful session evidence after the user has passed both gates. Running inference on-device reduces dependency on cloud audio processing and keeps the web layer focused on persistence, visibility, and control. Docker Compose makes the dashboard and database repeatable on a remote server, supporting the cloud-computing requirement without forcing the microcontroller to manage Wi-Fi or database credentials.

The two personal contributions documented in detail in this report are the voice recognition TinyML model (Serhii) and the movement detection TinyML model (Joel). The colour authentication model was contributed by group member **Artiom Gutu** (Edge Impulse handle `pepstee`, project `970107`) and is documented separately in his own section; it is referenced here only insofar as it forms part of the integrated firmware. The group contribution merged all three Edge Impulse models into one firmware build, built the serial-to-HTTP bridge, implemented session storage and replay, added Docker deployment, and applied a STRIDE-per-element security layer with bearer-token-protected ingest APIs and HMAC-SHA256-signed session cookies for dashboard operators.

---

## 1. Introduction and Business Value

Many IoT demonstrations stop at collecting raw sensor values. This project takes a more product-like approach: the device must first hear a voice command, then authenticate a colour, and only then record movement. The result is a staged interaction that can be explained to non-technical stakeholders and tested live. It demonstrates how embedded machine learning can add local intelligence to a small sensor platform while a web application provides the visibility and evidence trail expected from a connected system.

The Arduino Nano 33 BLE Sense is well suited for this because it combines a digital microphone, an APDS9960 colour and proximity sensor, and an LSM9DS1 inertial measurement unit with a Cortex-M4 microcontroller capable of TinyML workloads (Arduino, n.d.-a). Edge Impulse supports training and deploying embedded models as Arduino libraries, making it appropriate for a coursework prototype where the model pipeline and firmware deployment both need to be visible and verifiable (Edge Impulse, n.d.-a).

The business value is not only technical novelty. A staged edge workflow can be adapted to access control, equipment-use logging, gesture-controlled interfaces, or training demonstrations where the system must prove that a user completed a required sequence in the correct order. The dashboard records sessions, stores movement samples, and can stop a run from the browser. This creates auditable evidence for a live demo, while Docker and PostgreSQL make the server side repeatable and persistent rather than ephemeral.

---

## 2. Personal Contribution: Voice Recognition TinyML *(Serhii Sotskyi)*

The voice recognition stage provides the first interaction gate. The purpose of this model was deliberately narrow: identify the keyword *start* strongly enough to trigger the next phase, while treating background speech or silence as unknown. This small scope made the model suitable for a constrained embedded device because it avoided open-ended speech recognition and instead used keyword spotting. In the complete system, this model controls whether the demo remains in `WAITING_FOR_VOICE` or advances to colour authentication.

![Fig. P1. Edge Impulse voice dataset showing the start and unknown classes.](./media/image1.png)

*Fig. P1. Edge Impulse voice dataset showing the start and unknown classes used to train the keyword model.*

The dataset was organised in Edge Impulse around a positive class (*start*) and a negative class (*unknown*). The negative class provides the classifier with examples of audio that should not trigger the state change. This distinction is critical because a demo environment contains speech, movement noise, keyboard sounds, and room reverberation. A binary keyword model is only useful if it learns both the intended command and the non-command background distribution.

![Fig. P2. Data explorer view inspecting recorded voice samples before training.](./media/image2.png)

*Fig. P2. Data explorer view used to inspect recorded voice samples before training.*

Before training, the data explorer was used to inspect whether recorded samples looked plausible and whether the classes showed sufficient separation for a simple audio classifier. Edge Impulse audio workflows transform raw audio into signal-processing features before classification, rather than feeding raw waveforms to an embedded neural network (Edge Impulse, n.d.-b). This approach is appropriate for microcontrollers because it reduces the data passed into the model and makes inference more predictable on constrained hardware.

![Fig. P3. Final validation performance after training the voice model.](./media/image3.png)

*Fig. P3. Final validation performance after training the voice model.*

![Fig. P4. Confusion matrix for the voice model validation set.](./media/image4.png)

*Fig. P4. Confusion matrix showing how validation samples were classified.*

![Fig. P5. Validation metrics for the voice model.](./media/image5.png)

*Fig. P5. Validation metrics used to judge voice model quality.*

The validation results in Figures P3–P5 were used to decide whether the model was reliable enough for the live state machine. The confusion matrix is particularly important because a false positive is costly: the system would skip the voice phase and immediately advance to colour authentication without a spoken command. For a demonstration, occasional false negatives are less damaging because the user can say *start* again.

![Fig. P6. On-device performance estimate showing memory and latency suitability.](./media/image6.png)

*Fig. P6. On-device performance estimate for memory and latency suitability.*

On-device performance was checked before integration. The deployment estimate confirmed the voice model could run within the board's memory and timing constraints. TinyML deployments must fit within flash and RAM and must complete inference quickly enough that the interaction still feels live (Google, n.d.). The voice model was therefore evaluated not only by accuracy but by whether it could run continuously on the board alongside two other models.

![Fig. P7. Runtime bridge output proving the deployed voice model emits voice_debug and voice_start.](./media/image7.png)

*Fig. P7. Runtime bridge output proving the deployed voice model emits voice\_debug and voice\_start.*

After deployment, the firmware emitted `voice_debug` events containing the current state, threshold, arming status, streak, and classification scores. The implemented threshold was 0.75, with a startup arming delay to reduce false triggers. For demo reliability, the required streak was reduced to one confident detection, because earlier tests showed that demanding multiple consecutive high-confidence windows caused the system to miss spoken commands in real room conditions. The final design keeps the threshold high, adds an arming delay, and exposes debug scores so the operator can understand why the board did or did not advance.

The main limitation of this voice component is that it was trained for a small vocabulary under limited recording conditions and should not be presented as general speech recognition. Future improvements would include collecting more speakers, adding negative samples from the actual demo room, and testing different confidence thresholds.

---

## 3. Personal Contribution: Movement Detection TinyML *(Joel Shore)*

The movement detection component provides the final stage of the interaction once voice and colour authentication have succeeded. The aim was to classify five handling directions — left, right, up, down, and idle — from the Arduino Nano 33 BLE Sense inertial measurement unit. This model is not only a classification task in isolation; it is the source of the telemetry that gives the dashboard its main replay and evidence value.

### 3.1 Dataset Construction and Iterative Expansion

The initial dataset started with approximately 30 labelled samples per class for each of the five movement directions, giving a controlled baseline to verify that the Edge Impulse training pipeline was functional end-to-end. This starting point was deliberately modest: the goal at this stage was to confirm that samples could be collected, a model could be trained, and the Arduino library could be generated and deployed, not to optimise classification performance immediately.

This early dataset did not generalise reliably enough for live use. Additional training examples were therefore collected to improve class separation and to make the model more robust to variation in speed, handling style, and board orientation. The final dataset contained **19 minutes 17 seconds** of recorded IMU data, with **287 training samples** and **95 test samples** held out using approximately a 76%/24% train–test split. All five movement classes — down, idle, left, right, and up — were represented across both partitions.

![Fig. M1. Movement dataset summary — total collected data, train/test split, and sample distribution.](./media/image8.png)

*Fig. M1. Movement dataset summary showing total collected data, train/test split, and sample counts.*

### 3.2 Model Experimentation: Four Architectures Compared

Rather than accepting the first working result, four different model configurations were trained and evaluated. The rationale was that movement signals from an IMU contain rapid directional changes and short bursts of acceleration, which means feature extraction choices strongly determine how separable the five classes become in the neural network's input space. The four configurations were:

| Model | Processing Block | Classifier Accuracy (neural network) | Notes |
|---|---|---|---|
| 1 — IMU only | Raw IMU axes, no flatten | ~54% | Baseline; poor directional separation |
| 2 — Flatten + IMU | Flatten layer added to raw axes | ~54% | Similar result; left/right/down confusion persisted |
| 3 — Spectral analysis only | FFT-based spectral features | ~84% | Strong improvement; selected as candidate |
| 4 — Flatten + Spectral | Both flatten and spectral blocks | **83.8%** | Best balanced result; selected for deployment |

The 54% results for the IMU-based configurations were produced by Edge Impulse's **classifier accuracy** metric — the neural network's performance on the validation split during training. The 83.8% result for the best model was likewise the **neural network classifier accuracy** reported in the training output.

### 3.3 Weak Baseline Models (~54% Neural Network Classifier)

The IMU-only and flatten-plus-IMU configurations both produced a neural network classifier accuracy of approximately **54%** on the validation set. The weighted F1 score was 0.55, weighted precision 0.63, and weighted recall 0.54. The confusion matrix showed substantial overlap between left, right, and down, indicating that the raw time-domain IMU representation was not capturing the directional structure of the motion data effectively.

![Fig. M2. Lower-performing movement model used as a baseline — 54% classifier accuracy.](./media/image9.png)

*Fig. M2. Lower-performing movement model (54% neural network classifier accuracy) used as a baseline.*

These models were important as baselines because they confirmed that simply adding a flatten layer to raw IMU data was insufficient. The confusion between lateral classes (left/right) and the downward class suggested the time-domain flatten representation was conflating gravitational direction changes with deliberate horizontal gestures. Feature-engineering work was needed, not just more data.

### 3.4 Final Model: Neural Network Classifier 83.8%, Test Data 73.36%

The best-performing configuration used flatten combined with spectral analysis. The **neural network classifier accuracy — evaluated on the validation split during training — was 83.8%**, with a cross-entropy loss of 0.43. This figure is reported directly by Edge Impulse in the training output and represents how well the model performed on the in-training validation set.

![Fig. M3. Final movement model — 83.8% neural network classifier accuracy on validation data.](./media/image10.png)

*Fig. M3. Final selected movement model showing 83.8% neural network classifier accuracy.*

To obtain an honest measure of generalisation, the trained model was then evaluated on the **held-out test data** — the 95 samples that were separated before training began and never used during model development. Edge Impulse's model testing tool ran the deployed model against this unseen data and returned **73.36% accuracy**, with weighted average precision, recall, and F1 all at 0.83.

This distinction between the two accuracy figures is important. The 83.8% reflects the model's fit to its training and validation distribution. The 73.36% on held-out test data is the more meaningful estimate of how the model is likely to perform on genuinely new samples in a live demonstration. The ~10 percentage point gap is most likely a consequence of the test data itself: with only 95 held-out samples split across five classes, individual test samples carry significant weight, and any samples that were recorded with slightly different handling speed or board orientation to the training set will disproportionately penalise accuracy. A larger and more varied test partition would give a more stable estimate of true generalisation performance, and is expected to close this gap.

![Fig. M4. Model testing results — 73.36% accuracy on the held-out test partition.](./media/image10b.png)

*Fig. M4. Model testing results on the held-out 25% test split, showing 73.36% accuracy on unseen data. (Replace placeholder with screenshot of EI Studio "Model testing → Classify all" output for project 928825.)*

The class-level F1 scores from the final model were:

| Class | F1 Score |
|---|---|
| Down | 0.72 |
| Idle | 0.95 |
| Left | 0.81 |
| Right | 0.77 |
| Up | 0.75 |
| **Weighted average** | **0.83** |

Idle achieved near-perfect discrimination at 0.95 F1, which is particularly valuable because idle is the resting state during movement tracking — confusing stationary holding with a directional gesture would generate spurious session events. The lower F1 for down (0.72) reflects residual confusion with other dynamic classes, consistent with the gravitational ambiguity observed in the baseline models.

### 3.5 On-Device Performance and Embedded Suitability

Edge Impulse estimated on-device performance at approximately **1 ms inference time**, **1.4K peak RAM**, and **15.5K flash** using int8 quantisation with the EON Compiler. This made the model fully practical to include alongside the voice model, colour model, sensor libraries, and serial JSON output on the Nano 33 BLE Sense. A movement model that is accurate but too memory-heavy for the target board would defeat the system goal of running all inference locally on the microcontroller.

![Fig. M5. Data explorer and on-device performance view for the final movement model.](./media/image11.png)

*Fig. M5. Data-explorer and on-device performance view for the final movement model.*

### 3.6 Firmware Integration

The final model used **88 accelerometer samples at 44 Hz**, representing approximately two seconds of movement history. This window was reduced during firmware development from an earlier 3.5-second window to improve responsiveness during live tracking. Acceleration values were converted from g to m/s² before inference to match the model's training input specification. The firmware maintained a rolling buffer and emitted movement JSON output approximately every 250 ms once tracking had started, embedding both raw IMU telemetry and the inferred movement class and confidence in each event.

The main limitation of this contribution is that the model was trained on a coursework-scale dataset collected from a limited number of users under controlled conditions. The ~10 percentage point gap between training-set classifier accuracy (83.8%) and held-out test accuracy (73.36%) confirms overfitting to the collected distribution. Future work should increase operator diversity, collect samples under more varied speeds and orientations, and explore overlapping-window smoothing to reduce per-frame noise in live deployment.

---

## 4. Group System Architecture

The full group system is organised into three layers: **firmware**, **bridge**, and **web/cloud**. This layered design separates embedded sensing and inference from networking and persistence responsibilities, creating explicit trust boundaries between components.

```
┌─────────────────────────────────────────────────────────────────────┐
│  DEVICE BOUNDARY (trusted hardware)                                  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Arduino Nano 33 BLE Sense                                   │   │
│  │  PDM mic → Voice TinyML (970121)                             │   │
│  │  APDS9960 → Colour TinyML (970107)                           │   │
│  │  LSM9DS1 IMU → Movement TinyML (928825)                      │   │
│  │  State machine → JSON over USB serial @ 115200 baud          │   │
│  └───────────────────────────────────────────────────┬──────────┘   │
└──────────────────────────────────────────────────────│──────────────┘
                                                        │ USB Serial
┌──────────────────────────────────────────────────────│──────────────┐
│  LAPTOP/BRIDGE BOUNDARY (trusted host, private)       │              │
│                                                        ▼              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Python Bridge (pyserial + requests)                         │   │
│  │  • Reads serial, filters non-JSON                            │   │
│  │  • Validates JSON objects                                    │   │
│  │  • POST /api/movement  [BRIDGE_API_TOKEN required]           │   │
│  │  • GET  /api/bridge/control  [polls for shutdown signal]     │   │
│  └───────────────────────────────────────────────────┬──────────┘   │
└──────────────────────────────────────────────────────│──────────────┘
                                                        │ HTTP + Bearer token
┌──────────────────────────────────────────────────────│──────────────┐
│  DOCKER / APPLICATION BOUNDARY (server)               │              │
│                                                        ▼              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Next.js Web Application (container: web)                    │   │
│  │  • POST /api/movement                  [BRIDGE_API_TOKEN]    │   │
│  │  • GET  /api/latest                    [session cookie *]    │   │
│  │  • GET  /api/sessions, /api/sessions/* [session cookie *]    │   │
│  │  • POST /api/sessions/current/complete [cookie OR ADMIN tok] │   │
│  │  • GET  /api/bridge/control            [BRIDGE_API_TOKEN]    │   │
│  │  • POST /api/auth/login, /api/auth/logout                    │   │
│  │      * dashboard reads are gated by an HMAC-signed session   │   │
│  │        cookie when DASHBOARD_PASSWORD is configured;         │   │
│  │        ingest endpoints are unaffected by login state.       │   │
│  └───────────────────────────────────────────────────┬──────────┘   │
│                                                        │ Internal Docker net │
│  ┌────────────────────────────────────────────────────▼──────────┐   │
│  │  PostgreSQL 16 (container: postgres)                          │   │
│  │  Port bound to 127.0.0.1 — not externally exposed            │   │
│  │  Named volume for persistent session storage                  │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                   ▲ public read endpoints (HTTP/HTTPS)
             Dashboard browser users
```

*Fig. G1. End-to-end architecture showing trust boundaries, containers, authentication requirements, and data flow.*

On the Arduino, the firmware reads the microphone through the PDM library, captures colour data from the APDS9960 sensor, and acquires accelerometer and gyroscope readings from the LSM9DS1 IMU. These sensor inputs feed three independent TinyML inference paths and the board emits structured JSON events over USB serial rather than connecting directly to the network.

This architectural choice creates a clear trust boundary and simplifies the embedded device. By avoiding direct Wi-Fi or cloud connectivity on the microcontroller, the firmware does not need to hold server credentials, manage TCP/IP reliability, or implement higher-level web protocols. For a coursework demonstration this is a strong design trade-off because it keeps the embedded layer deterministic and explainable while moving operational complexity into the bridge and server layers.

The bridge layer runs on a host laptop physically attached to the board via USB. It opens the serial device at 115200 baud, filters out non-JSON lines, validates that each line is a JSON object, and forwards valid events to the web API. With the optional `--auth-endpoint` flag (`AUTH_ENDPOINT`) it can route `colour_authenticated` events to a dedicated authorisation URL while keeping high-volume movement telemetry on the main `/api/movement` endpoint. It also polls a bridge-control endpoint so that the dashboard can request a clean shutdown of the bridge process — more graceful than simply disconnecting the USB serial session.

The web/cloud layer is a Next.js application with API route handlers and a dashboard frontend. The server ingests events, exposes the latest state, lists and replays sessions, and manages lifecycle controls such as completing or stopping a session. When a database connection string is configured, the application persists data in PostgreSQL; without one, it falls back to in-memory storage for rapid local testing (Next.js, n.d.).

---

## 5. Firmware and Three-Model Integration

The firmware implements a state machine with three main states: `WAITING_FOR_VOICE`, `WAITING_FOR_COLOUR`, and `TRACKING_MOVEMENT`. After reset, the board starts in the voice state. A successful *start* classification emits `voice_start` and transitions to the colour state. A successful green classification emits `colour_authenticated` and transitions to movement tracking. Once movement tracking begins, the board continuously sends movement events containing raw IMU values and the movement model's predicted class and confidence.

```
          ┌──────────────────┐
  reset → │ WAITING_FOR_VOICE│
          └────────┬─────────┘
                   │ voice_start (confidence ≥ 0.75, arming delay passed)
          ┌────────▼──────────┐
          │WAITING_FOR_COLOUR │
          └────────┬──────────┘
                   │ colour_authenticated (green ≥ 0.70 × 3 consecutive reads)
          ┌────────▼──────────┐
          │ TRACKING_MOVEMENT │ → emits movement JSON every ~250 ms
          └───────────────────┘
```

*Fig. G2. Firmware state machine showing the three states and their transition conditions.*

Integrating three Edge Impulse exports into one firmware sketch was the hardest group firmware challenge. Each generated Arduino library normally assumes it is the only Edge Impulse model in the sketch, so including three inferencing headers directly creates conflicting symbols such as `run_classifier`, `run_classifier_init`, shared macros, and model metadata. The solution was to create a local `combined_inferencing` Arduino library containing one shared SDK copy, merged model metadata, and explicit handles for the three models: voice (970121), colour (970107), and movement (928825). The sketch includes only `combined_inferencing.h` and calls classifier functions through the selected handle.

![Fig. G3. Bridge output showing the voice phase and transition after a detected start command.](./media/image12.png)

*Fig. G3. Bridge output showing the voice phase and transition after start.*

The colour authentication model is the contribution of group member **Artiom Gutu** (Edge Impulse handle `pepstee`, project `970107`, four classes: `red`, `green`, `blue`, `other`). It reads APDS9960 red, green, blue, and clear values mapped to model input channels ch1–ch4. The firmware requires the `green` class to exceed a 0.70 threshold for three consecutive reads before colour authentication succeeds. This is more robust than a single raw RGB threshold because the model can learn from recorded colour examples rather than relying on a fixed ratio.

Following the work on the `colour-auth-cleanup` branch, the firmware now emits a richer `colour_authenticated` payload that carries the model's top label, its confidence, a board `device_id`, and a board-side ISO `timestamp` — for example:

```json
{"event":"colour_authenticated","colour":"green","confidence":0.93214,"device_id":"nano33-bls-01","timestamp":"2026-04-29T14:22:51Z"}
```

These extra fields turn colour authentication into a true authorisation event rather than a bare flag. The bridge can be configured with `--auth-endpoint` (or `AUTH_ENDPOINT`) so that `colour_authenticated` events are POSTed to a dedicated authorisation endpoint, separate from the high-volume `/api/movement` ingest path. This separation cleanly distinguishes a low-rate authorisation signal from telemetry, and makes it easier to apply different rate limits, audit logging, or even a different bearer token to the authorisation channel without affecting movement ingest.

![Fig. G4. Bridge output showing colour authentication events.](./media/image13.png)

*Fig. G4. Bridge output showing colour authentication events.*

The movement model uses the 88-sample rolling buffer at 44 Hz described in Section 3. The firmware emits both raw accelerometer/gyroscope values and the inferred class and confidence because raw telemetry supports debugging model mistakes, while `movementClass` and `movementConfidence` provide the TinyML interpretation.

![Fig. G5. Bridge output showing movement classification events.](./media/image14.png)

*Fig. G5. Bridge output showing movement classification events.*

The trade-off of this one-directional state machine is that restarting the bridge does not reset the board. A new full demonstration requires a board hardware reset to return to `WAITING_FOR_VOICE`. This was accepted because it keeps the firmware logic simple and deterministic for a live demonstration.

---

## 6. Bridge, Dashboard, and Persistent Session Recording

The Python bridge forms the operational boundary between physical hardware and the web system. It uses `pyserial` to read from the USB serial port and a `requests.Session` to POST JSON payloads, with a bounded retry queue (capacity 500 events) and exponential back-off (capped at 30 s) so that transient server unavailability does not cause data loss. A serial-silence watchdog terminates the process if no data has been received for 60 s, which surfaces unplugged-board conditions cleanly during a live demo. Because only one process can own the serial port at a time, the bridge replaces the Arduino Serial Monitor during demonstrations. Verbose mode prints compact payloads and HTTP response codes, providing a practical runtime debugging surface without modifying the firmware.

The dashboard is designed around **session recording** rather than only live status. A `setup_status` event starts a new session. Later `voice_start`, `colour_authenticated`, and movement events are attached to the active session in sequence. The database stores sessions, raw events, movement samples, and recording state. The `movement_samples` table separates chartable numeric telemetry from the raw JSON payload, while the `events` table preserves original events for auditability. This gives the project both a live monitor and a persistent evidence store.

![Fig. G2. Live dashboard showing the current recorded session state.](./media/image15.png)

*Fig. G2. Live dashboard showing the current recorded session state.*

The dashboard shows business-facing status rather than only developer logs. It reports whether the voice, colour, and movement stages are waiting or complete, displays the raw latest JSON event, and lists recorded sessions with timestamps. The *Stop current session* button controls the lifecycle from the browser. When triggered, the server completes an authenticated run. If voice or colour authentication was not completed, the incomplete session data is deleted because it does not represent a successful demo run. Stop also sets bridge-control state so the bridge exits cleanly.

![Fig. G6. Recorded movement session visualised in the web dashboard with a replay chart.](./media/image16.png)

*Fig. G6. Recorded movement session visualised in the web dashboard.*

Figure G6 shows why recording sessions is more valuable than printing logs. The dashboard turns repeated movement events into a replayable chart with confidence values and timestamps. This supports post-demo analysis: the team can show that the system detected voice, authenticated colour, entered tracking, and captured directional movement data — providing evidence even after the live interaction has ended.

---

## 7. Cloud Deployment, Docker, and What Live Deployment Means

### 7.1 Docker Compose Architecture

The deployable server path uses Docker Compose to run the web application and PostgreSQL database as a repeatable multi-container stack (Docker, n.d.-a). The `postgres` service uses the `postgres:16-alpine` image with a named volume for persistent data. The `web` service builds the Next.js application from `web/Dockerfile` and runs a database migration script before starting the production server, so a fresh server creates the required schema tables automatically. Docker Compose environment variables configure Postgres credentials, the public web port, and API tokens (Docker, n.d.-b).

![Fig. G9. Docker Compose stack running the web application and database services.](./media/image17.png)

*Fig. G9. Docker Compose stack running the web application and database services.*

The database port is bound to `127.0.0.1` on the host machine, while the web container communicates with it through the internal Docker network only. This means the database is never directly accessible from the public internet, reducing the attack surface to the single web API endpoint.

### 7.2 What "Live Deployment" Means for This Project

In the context of this coursework, *live deployment* does not mean global-scale production hosting. It means the dashboard and database run on a remote or semi-remote server — a cloud VM, a shared university server, or any reachable network host — and remain available beyond a single local browser session. The bridge posts events to that server over HTTP, the dashboard is accessible from any browser, and session data persists across container restarts.

This is sufficient to demonstrate core cloud-computing concepts: service separation between the board, bridge, and server; persistent relational storage; environment-based configuration; repeatable container deployment; and the ability to redeploy changes using the `_update_server` script (`git pull --ff-only`, container rebuild, restart, status check). The bridge is intentionally not containerised because it requires direct USB serial access to the local device — a sensible boundary that reflects a real hybrid edge-cloud architecture where sensing and inference stay at the edge and aggregation and display move to the cloud.

### 7.3 Why HTTPS Is Required in a Real Live Deployment

The current bearer-token security model depends entirely on **transport confidentiality**. Bearer tokens sent over plain HTTP are visible to any network observer on the path between the bridge client and the server. On a university Wi-Fi network or any shared environment, a passive observer could capture `BRIDGE_API_TOKEN` or `ADMIN_API_TOKEN` from a single intercepted request and replay it to fabricate events or stop sessions.

For a genuine live deployment accessible over the public internet, the web service should be placed behind a TLS-terminating reverse proxy such as **Nginx** or **Caddy**. The proxy handles HTTPS certificate management (e.g., via Let's Encrypt) and forwards only decrypted, trusted traffic to the application container. The internal Docker network carries plain HTTP between the proxy and the web container, which is acceptable because that traffic never leaves the host. Without HTTPS, the bearer-token scheme provides no real protection on any network the attacker can observe — documenting this as a known production gap, rather than omitting it, demonstrates security awareness that is important at higher grade levels.

---

## 8. Security Using STRIDE-per-element

### 8.1 Threat Modelling Framework

STRIDE classifies threats as **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, and **E**levation of privilege (Microsoft, n.d.). The form used here is **STRIDE-per-element** (Shostack, 2014), in which the analyst walks the system's data flow diagram and applies only the STRIDE categories that map to each element type — external entities (S, R), processes (S, T, R, I, D, E), data stores (T, R, I, D), and data flows (T, I, D). This forces complete coverage and avoids common category errors such as assigning *elevation of privilege* to a database. The full per-element catalogue with **CVSS v3.1 base scores** lives in `docs/threat-model.md`; the table below is the report-level summary.

The choice of CVSS v3.1 over the older DREAD scoring used in some textbooks is deliberate: each CVSS metric has a published, named rubric, impact and exploitability are kept separate before being combined deterministically, and the resulting vector string is portable across tools and time (FIRST, 2019). DREAD's heterogeneous, subjective 1–10 axes were abandoned by Microsoft internally around 2008 for the same reasons (Shostack, 2014, §9.2).

Main assets: sensor event integrity, session history auditability, control actions (bridge shutdown, session completion), and shared secrets (`BRIDGE_API_TOKEN`, `ADMIN_API_TOKEN`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`).

Main trust boundaries:
1. USB serial from the board to the bridge (physical, trusted)
2. HTTP from bridge and browser clients to the web API (semi-trusted, network)
3. Application to PostgreSQL inside the Docker network (internal, trusted)

### 8.2 STRIDE Analysis by Boundary

| Threat | Boundary | Example | Mitigation in this build |
|---|---|---|---|
| **Spoofing** | HTTP → API | Attacker fabricates board events | `BRIDGE_API_TOKEN` bearer on `POST /api/movement` and `GET /api/bridge/control`; constant-time comparison via `crypto.timingSafeEqual` |
| **Tampering** | HTTP → API | Attacker injects malformed or oversized payloads | 8 KB body cap, JSON-object validation, strict event-name whitelist (`KNOWN_EVENTS`), per-field numeric bounds (acc ≤ 16 g, gyro ≤ 2000 dps) on movement events |
| **Repudiation** | API → DB | Dispute over whether an event occurred | Raw `events` table preserves original JSON before fan-out into derived tables |
| **Information disclosure** | HTTP (plain) | Token captured on a shared network | Production deployment requires HTTPS-terminating reverse proxy; documented in §7.3 as a known gap on the lab build |
| **Denial of service** | HTTP → API | Flooding the ingest endpoint | Per-IP token-bucket rate limit (`INGEST_RATE_LIMIT_PER_MIN`, returns HTTP 429); body cap and event whitelist further reduce processing per request |
| **Elevation of privilege** | HTTP → API | Anonymous viewer calls an admin endpoint | `POST /api/sessions/current/complete` requires either a valid HMAC-signed `iot_session` cookie *or* `ADMIN_API_TOKEN`; dashboard reads gated by the same cookie when `DASHBOARD_PASSWORD` is set |

### 8.3 Implemented Mitigations

The implemented controls go beyond the report-level summary:

- **Bearer-token ingest.** `POST /api/movement` and `GET /api/bridge/control` require `Authorization: Bearer <BRIDGE_API_TOKEN>` (RFC 6750; IETF, 2012). Token comparison uses Node.js `crypto.timingSafeEqual` to prevent timing oracles (Node.js, n.d.).
- **Hybrid stop authorisation.** `POST /api/sessions/current/complete` accepts either a valid HMAC-SHA256-signed session cookie (issued by `POST /api/auth/login` against `DASHBOARD_PASSWORD`) *or* `ADMIN_API_TOKEN` as a Bearer token. The dashboard takes the cookie path; external automation takes the bearer path. This avoids storing any admin secret in the browser.
- **Operator-session cookies.** When `DASHBOARD_PASSWORD` and `SESSION_SECRET` are configured, all dashboard pages and read APIs are placed behind a Next.js middleware that requires a valid session cookie. The cookie is signed with HMAC-SHA256 (12-hour TTL), set `HttpOnly`, `SameSite=Lax`, and `Secure` when behind HTTPS.
- **Input validation at the ingest boundary.** Every payload is parsed inside an 8 KB envelope, must be a JSON object with a string `event` field, must match a closed set of known event names, and — for `movement` events — must have numeric `ax/ay/az/gx/gy/gz` fields within physically plausible IMU bounds. Anything else returns HTTP 400 before any database write happens.
- **Per-IP rate limiting.** A token-bucket limiter (`INGEST_RATE_LIMIT_PER_MIN`, scoped per source IP) caps ingest throughput and returns HTTP 429 when exceeded. Default is unlimited for the lab build; production deployments set a finite value.
- **Database isolation.** PostgreSQL is bound to `127.0.0.1` on the host, so the only network-reachable interface is the web container. The web container talks to the database on the internal Docker network only.
- **Authorisation channel separation.** The bridge `--auth-endpoint` flag (Section 5) lets `colour_authenticated` events be POSTed to a different URL from movement telemetry, allowing different rate limits or audit handling on the authorisation channel.

![Fig. G7. Unauthorised API request returning HTTP 401 when no bearer token is supplied.](./media/image18.png)

*Fig. G7. Unauthorised API request returning HTTP 401 when no bearer token is supplied.*

![Fig. G8. Authorised API request succeeding with a valid bearer token.](./media/image19.png)

*Fig. G8. Authorised API request succeeding with a valid bearer token.*

The end-to-end auth boundary is verified by `verify.sh` at the repository root, which exercises every protected endpoint and asserts the expected HTTP status — see Section 9.3.

### 8.4 Residual Risks

- **Plain HTTP on the lab build.** Tokens and session cookies can be captured in transit on shared networks. Production deployment requires HTTPS behind a TLS-terminating reverse proxy (§7.3).
- **Shared bearer secrets.** `BRIDGE_API_TOKEN` and `ADMIN_API_TOKEN` give role separation but no individual user accountability. A production system should issue named operator accounts with per-user audit log lines.
- **Single shared dashboard password.** `DASHBOARD_PASSWORD` is one secret across all viewers. Per-user accounts and SSO would be required for any multi-tenant deployment.
- **Rate-limit memory only.** The token-bucket state lives in process memory, so a multi-replica deployment would need to move it into Redis or a shared cache.
- **Physical trust.** The board and bridge laptop are fully trusted — physical access to either gives complete system access. This is in scope for a coursework demonstration, but a real warehouse deployment would need tamper-evident enclosures and signed firmware updates.

These risks are proportionate for a controlled university demonstration; each is mapped to a specific mitigation in `docs/threat-model.md` before any production or public deployment.

---

## 9. Testing and Evaluation

### 9.1 End-to-End Manual Test Procedure

The manual test procedure follows the expected state-machine sequence:

1. Start the PostgreSQL and web containers with `docker compose up`
2. Start the Python bridge targeting the board's serial port and the server URL
3. Reset the Arduino board; observe `setup_status` JSON in bridge output
4. Say *start*; observe `voice_start` event in Figure G3 and the dashboard
5. Show green colour to the APDS9960 sensor; observe `colour_authenticated` in Figure G4
6. Move the board in five directions; observe movement classification in Figure G5
7. Open the dashboard; observe the session chart in Figure G6
8. Stop the session; confirm session persists after bridge shutdown

### 9.2 Movement Model Evaluation Summary

The movement model evaluation demonstrates iterative engineering across four configurations. The key distinction is between two accuracy figures:

- **Neural network classifier accuracy** — Edge Impulse's validation-set accuracy during training, reflecting how well the model fits the training distribution
- **Model test accuracy** — the result when the final trained model is evaluated on the held-out 25% test partition that was never seen during training

| Configuration | Classifier Accuracy (neural network) | Test Accuracy (held-out data) | Deployed? |
|---|---|---|---|
| IMU only | ~54% | — | No |
| Flatten + IMU | ~54% | — | No |
| Spectral analysis | ~84% | — | No |
| **Flatten + Spectral** | **83.8%** | **73.36%** | **Yes** |

The ~10 percentage point gap between the 83.8% classifier accuracy and the 73.36% held-out test accuracy reflects overfitting to the collected distribution — expected at coursework dataset scale. The 73.36% figure is the more meaningful estimate of real-world performance. On-device, the deployed model runs at 1 ms inference with 1.4K peak RAM and 15.5K flash, confirming embedded viability.

### 9.3 API Security Tests

The repository ships `verify.sh`, which exercises every protected boundary against a running stack and asserts the expected HTTP status. The script covers:

- Anonymous request to a dashboard page → `302` redirect to `/login`
- `POST /api/auth/login` with the wrong password → `401`
- `POST /api/auth/login` with the correct password → `200` plus a `Set-Cookie: iot_session=…`
- `POST /api/movement` with no bearer → `401`; with the correct `BRIDGE_API_TOKEN` → `200`
- `POST /api/sessions/current/complete` with no auth → `401`; with `ADMIN_API_TOKEN` → `200`; with a valid session cookie → `200`
- `POST /api/movement` with an unknown event name or oversize body → `400`/`413`

When run against a configured deployment, all checks pass, confirming that role-based access control, input validation, and the hybrid stop-authorisation path all function as designed.

### 9.4 Docker Deployment Tests

Docker Compose testing verified that both services started correctly, database migrations completed before the application accepted requests, persisted session data survived container restarts, and the `_update_server` script executed a successful rolling redeployment.

---

## 10. Conclusion

The project demonstrates a complete TinyML IoT workflow rather than a disconnected sensor classifier or a simple web dashboard. At the personal contribution level, this report documents two of the three embedded ML development processes in detail: voice recognition as the first interaction gate (Serhii) and movement detection as the final evidence-generating stage (Joel). The third on-device model — colour authentication — was contributed by group member Artiom Gutu and is documented in his own section. At the group level, the project integrates all three models, a shared firmware state machine, a Python serial bridge with retry queue and optional authorisation-endpoint routing, a Next.js dashboard with HMAC-signed operator sessions, PostgreSQL persistence, Docker deployment, and STRIDE-per-element API protection backed by `verify.sh` boundary tests.

The strongest academic value of the system is explainability combined with deployment realism. A stakeholder can observe the staged interaction live, inspect the resulting dashboard session, and understand how local edge inference and cloud-style persistence work together. The strongest technical lesson from the movement contribution is that classifier performance depended primarily on preprocessing architecture rather than data volume alone — the flatten and spectral analysis combination succeeded because it matched the abrupt, short-duration characteristics of directional IMU gestures at 44 Hz. The distinction between neural network classifier accuracy (83.8%) and held-out test accuracy (73.36%) also illustrates an important machine learning evaluation principle: training-set performance is not a reliable proxy for generalisation, and honest reporting requires evaluating models on data that was genuinely unseen during development.

Future work should address the residual risks identified in Section 8.4, add HTTPS behind a reverse proxy for any public deployment, increase dataset diversity across more users and conditions, and reduce debug verbosity once live behaviour is stable. Even with these limitations, the prototype provides technically credible, end-to-end evidence for how low-cost embedded AI can be connected to a cloud-style monitoring, control, and evidence layer.

---

## References

Arduino (n.d.-a) *Nano 33 BLE Sense*. Available at: https://docs.arduino.cc/hardware/nano-33-ble-sense/ (Accessed: 28 April 2026).

Arduino (n.d.-b) *Arduino\_APDS9960 library*. Available at: https://github.com/arduino-libraries/Arduino_APDS9960 (Accessed: 28 April 2026).

Arduino (n.d.-c) *Arduino\_LSM9DS1 library*. Available at: https://github.com/arduino-libraries/Arduino_LSM9DS1 (Accessed: 28 April 2026).

Docker (n.d.-a) *Docker Compose documentation*. Available at: https://docs.docker.com/compose/ (Accessed: 28 April 2026).

Docker (n.d.-b) *Interpolation: Docker Compose environment variables*. Available at: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ (Accessed: 28 April 2026).

Docker (2022) *How to use the Postgres Docker Official Image*. Available at: https://www.docker.com/blog/how-to-use-the-postgres-docker-official-image/ (Accessed: 28 April 2026).

Edge Impulse (n.d.-a) *Run Arduino library*. Available at: https://docs.edgeimpulse.com/docs/run-inference/arduino-library (Accessed: 28 April 2026).

Edge Impulse (n.d.-b) *Sound recognition*. Available at: https://docs.edgeimpulse.com/docs/tutorials/audio-classification (Accessed: 28 April 2026).

FIRST (2019) *Common Vulnerability Scoring System version 3.1: Specification Document*. Available at: https://www.first.org/cvss/v3.1/specification-document (Accessed: 29 April 2026).

Google (n.d.) *LiteRT for Microcontrollers*. Available at: https://ai.google.dev/edge/litert/microcontrollers/overview (Accessed: 28 April 2026).

IETF (2012) *RFC 6750: The OAuth 2.0 Authorization Framework: Bearer Token Usage*. Available at: https://www.rfc-editor.org/rfc/rfc6750 (Accessed: 28 April 2026).

Microsoft (n.d.) *Threats: Microsoft Threat Modeling Tool*. Available at: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats (Accessed: 28 April 2026).

Shostack, A. (2014) *Threat Modeling: Designing for Security*. Indianapolis: Wiley.

Next.js (n.d.) *Route Handlers*. Available at: https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware (Accessed: 28 April 2026).

Node.js (n.d.) *Crypto: crypto.timingSafeEqual*. Available at: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b (Accessed: 28 April 2026).

PostgreSQL Global Development Group (n.d.) *PostgreSQL documentation*. Available at: https://www.postgresql.org/docs/ (Accessed: 28 April 2026).

---

## Appendix A. Evidence Map

| Evidence | Section | What It Proves |
|---|---|---|
| Figs. P1–P7 | §2 | Personal voice TinyML workflow, validation metrics, on-device feasibility, and deployed runtime output |
| Figs. M1–M5 | §3 | Movement dataset, four-model comparison, neural network vs. test accuracy distinction, on-device performance |
| Fig. G1 | §4 | End-to-end architecture with trust boundaries and deployment layers |
| Fig. G2 (state diagram) | §5 | Firmware state machine with transition conditions |
| Figs. G3–G5 | §5 | Bridge output for each state transition: voice, colour, movement |
| Fig. G2 (dashboard) | §6 | Live dashboard recording session state |
| Fig. G6 | §6 | Session replay chart with movement confidence values |
| Fig. G9 | §7 | Docker Compose deployment stack |
| Figs. G7–G8 | §8 | STRIDE-inspired API protection: 401 and 200 responses |
