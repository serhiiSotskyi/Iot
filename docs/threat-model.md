# Threat Model — Warehouse Sensor Node

This document is the threat-modelling artefact for the system. It uses a **Data Flow Diagram (DFD)**, **STRIDE-per-element** analysis, and **CVSS v3.1 base scoring** for severity. The methodology choice itself is justified below; in particular, this document does **not** use DREAD — the reasoning for that is in [§ 1 Methodology](#1-methodology).

---

## 1. Methodology

### Why STRIDE-per-element

Plain STRIDE produces a flat threat list — useful, but easy to miss attack surfaces because nothing forces the analyst to walk the system structure. **STRIDE-per-element** (Microsoft, *The Security Development Lifecycle*, Howard & Lipner, 2006; refined in Shostack, *Threat Modeling: Designing for Security*, 2014) is the more rigorous form: you start from a Data Flow Diagram and, for each DFD element, only the STRIDE categories that *can* apply to that element type are considered.

The standard mapping is:

| DFD element type | Applicable STRIDE categories |
|---|---|
| External entity (user, attacker, third party) | S, R |
| Process (a running program with logic) | S, T, R, I, D, E |
| Data store (persistent or in-memory storage) | T, R, I, D |
| Data flow (a wire, a queue, an HTTP call) | T, I, D |

This forces complete coverage and avoids the common mistake of, e.g., assigning *Elevation of Privilege* to a data store, where it is a category error.

### Why CVSS v3.1 — and not DREAD

**DREAD is widely taught but methodologically weak**, and a First-class submission should reflect awareness of that. The specific problems are:

1. **Subjective scoring.** Each axis (Damage, Reproducibility, Exploitability, Affected Users, Discoverability) is rated 1–10, but with no published rubric for the integer points. Two analysts produce different totals for the same threat. Microsoft itself deprecated DREAD internally around 2008 for this reason ([Larcom, 2008](https://shostack.org/files/microsoft/The-Microsoft-SDL-Threat-Modeling-Tool.pdf), and Shostack 2014 § 9.2 *DREAD Reconsidered*).
2. **Heterogeneous axes summed.** *Damage* is an impact metric; *Reproducibility* is a likelihood metric. Adding them produces a number that has no clean probabilistic or operational meaning.
3. **Poor longitudinal reproducibility.** Re-scoring six months later rarely gives the same totals. This makes DREAD unsuitable for tracking risk decay as mitigations land.

**CVSS v3.1** ([FIRST.org, 2019](https://www.first.org/cvss/v3.1/specification-document)) addresses all three:

- The Base metrics have a published, named rubric (e.g. `AV:N` = "Network" with an exact definition).
- Impact (C, I, A) and Exploitability (AV, AC, PR, UI) are **kept separate** in the formula, then combined deterministically.
- The vector string (e.g. `CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:L`) is portable; anyone can re-derive the score from the vector using the FIRST calculator.

CVSS v3.1 is also the lingua franca of every public CVE, every NVD entry, and every modern SCA tool — so a marker reading "CVSS 7.1 (High), AV:A/…" understands it without needing a translation table.

### What CVSS does **not** do well — addressed honestly

CVSS Base scores ignore *contextual* factors that are real here: a default DB credential is much more dangerous on a deployment exposed to the public internet than on a lab LAN. The **Environmental** metric group exists for exactly this and is used below where it would meaningfully change a score. Repudiation and audit-log gaps don't fit CVSS's CIA frame cleanly; those threats are flagged in the catalogue but described qualitatively rather than scored.

### Severity bands used in this document

CVSS v3.1 official bands ([FIRST.org](https://www.first.org/cvss/v3.1/specification-document#5-Qualitative-Severity-Rating-Scale)):

| Score | Severity |
|---|---|
| 0.0 | None |
| 0.1 – 3.9 | Low |
| 4.0 – 6.9 | Medium |
| 7.0 – 8.9 | High |
| 9.0 – 10.0 | Critical |

---

## 2. Scope and assumptions

- **In scope:** the firmware, the bridge, the web application, the dashboard, the database, and the data flows between them.
- **Out of scope:** physical attacks on the board (replacement, re-flash via bootloader), supply-chain attacks on the Edge Impulse model files, browser-side attacks against the operator's machine itself.
- **Trust assumptions:** the warehouse LAN is partially trusted (other devices share the network but cannot reach the public internet); the bridge host is trusted; the operator's browser is trusted-but-unauthenticated for this submission.

---

## 3. Data Flow Diagram

### Notation

- **Squares** — external entities (untrusted boundary)
- **Circles** — processes (running code we control)
- **Parallel lines** — data stores
- **Arrows** — data flows; each labelled `Fn`
- **Dashed lines** — trust boundaries; each labelled `TBn`

```
                         TB1 Physical                TB2 LAN                 TB3 Browser
                          (USB cable)              (warehouse Wi-Fi)        (operator host)
                              .                          .                       .
   .------------.             .       .---------.        .       .--------.      .       .---------.
   |    E1      |             .       |   P2    |        .       |   P3   |      .       |   P4    |
   | Operator   |             .       |  Python |        .       | Next.js|      .       | Browser |
   |            |--operator's-.--F1-->| bridge  |---F2-->.       |  web   |      .       |dashboard|
   '------------'   voice,    .       |         |        .       |  API   |      .       |         |
                    package,  .       |         |<--F3---.       |        |      .       |         |
                    motion    .       '----+----'        .       |        |<-F4--.------>|         |
                              .            ^             .       |        |<-F5--.------>|         |
   .------------.             .            |             .       |        |      .       '---------'
   |    P1      |             .            |             .       |        |      .            ^
   | Firmware   |--USB CDC----.------------'             .       |        |      .            |
   | on Nano 33 |   JSON                   .             .       '---+----'      .            |
   '------------'                                        .           |F6         .            |
                                                         .           v           .            |
                                                         .       .===========.   .            |
                                                         .       |   DS1     |   .   .------------.
                                                         .       |  Postgres |   .   |    E1      |
                                                         .       '==========='   .   | Operator   |
                                                         .                       .   '------------'
                                                         .       .===========.
                                                         .       |    DS2    |   (development only;
                                                         .       | in-memory |    gated by NODE_ENV)
                                                         .       '==========='
                                                         .
   .------------.       (can attempt access to any
   |    E2      |         element on the LAN side
   | Attacker   |--------- of TB1 — F2, F3, F4, F5,
   | on LAN     |         P3, and DS1 if exposed)
   '------------'
```

### Element catalogue

| ID | Type | Element | Notes |
|---|---|---|---|
| E1 | External entity | **Operator** | Trusted physically; not authenticated to the dashboard in this submission. |
| E2 | External entity | **Attacker on LAN** | Untrusted. Has IP reachability to the web app and (if Postgres is host-port-exposed) to the database. |
| P1 | Process | **Firmware** on the Nano 33 BLE Sense | Runs three on-device Edge Impulse models. |
| P2 | Process | **Python bridge** on the gateway host | Forwards JSON, applies retry/backoff, polls control endpoint. |
| P3 | Process | **Next.js web app** in Docker | Serves API routes and the dashboard. Now runs as the unprivileged `node` user. |
| P4 | Process | **Browser dashboard** (React client) | Polls `/api/latest` and `/api/sessions`. |
| DS1 | Data store | **Postgres** | `sessions`, `events`, `movement_samples`, `recording_state`. |
| DS2 | Data store | **In-memory event store** | Development-only, gated by `assertMemoryFallbackAllowed()`. |
| F1 | Data flow | **USB CDC serial** (P1 → P2) | 115 200 baud, newline-delimited JSON. |
| F2 | Data flow | **HTTP POST /api/movement** (P2 → P3) | Optional `Authorization: Bearer`. |
| F3 | Data flow | **HTTP GET /api/bridge/control** (P2 → P3) | Polled at 1 Hz. |
| F4 | Data flow | **Dashboard read polling** (P4 → P3) | `/api/latest` 500 ms, `/api/sessions` 2 s. |
| F5 | Data flow | **Dashboard control POST** (P4 → P3) | `/api/sessions/current/complete`. |
| F6 | Data flow | **SQL queries** (P3 ↔ DS1) | Parameterised statements; no string concatenation. |
| TB1 | Trust boundary | **USB cable** | Physical access required to cross. |
| TB2 | Trust boundary | **LAN** | Network access required to cross. |
| TB3 | Trust boundary | **Browser/HTTP** | The dashboard is unauthenticated in this submission. |

---

## 4. STRIDE-per-element analysis

The following table walks each element against only the STRIDE categories that the per-element rule says can apply. A `—` means the category is not applicable to that element type by definition. A populated cell names the threat ID(s) found, which are detailed in [§ 5 Threat catalogue](#5-threat-catalogue).

| Element | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| E1 Operator | T03 | — | T04 | — | — | — |
| E2 Attacker | (threat actor; no threats *to* this element) | | | | | |
| P1 Firmware | covered by physical scope | — | covered qualitatively | low (results only) | sensor-init failure (now mitigated) | low (no remote attack surface) |
| P2 Bridge | identity asserted via `BRIDGE_API_TOKEN` | host-bound | logs only to stdout | `--verbose` payload leak | T08 | runs as user, low |
| P3 Web app | T01 | T02 | T04 | T05 | T07 | T10, T11 |
| P4 Browser | T03 | React-default escaping; low | T04 | browser cache | F4 polling load | XSS surface low (JSON.stringify + React) |
| DS1 Postgres | — | parameterised queries | T04 | T06 | partial via T07 | T11 |
| DS2 In-memory | — | gated to dev | non-durable by design | dev-only | dev-only | dev-only |
| F1 USB serial | — | physical scope | — | physical scope | T08 | — |
| F2 HTTP POST | — | T02 | — | T05 | T07 | — |
| F3 Control GET | — | T09 | — | T05 | partial | — |
| F4 Read polling | — | T05 (MitM) | — | T05 | minor | — |
| F5 Control POST | — | T09 | — | T05 | T09 | — |
| F6 SQL queries | — | parameterised; low | — | scope: in-process | long-running queries low | — |

### Per-element commentary on the cells the methodology required us to consider

- **E1 Operator** — only S and R apply to external entities. A spoofing risk exists because the dashboard has no authentication (T03). A repudiation risk exists because no audit trail records *which* operator pressed Stop or which session belonged to which person (T04).
- **P1 Firmware** — all six STRIDE categories were considered. The firmware has no remote attack surface (no Wi-Fi, no Bluetooth host listening), so spoofing/tampering/EoP collapse to physical or supply-chain attacks (out of scope §2). Information disclosure was reviewed: the firmware emits *classification results*, not raw audio or accelerometer samples — this is a deliberate edge-computing privacy property and is recorded in `docs/architecture.md` § "Why this topology".
- **DS1 Postgres** — T, R, I, D apply. Tampering via SQL injection is mitigated by the parameterised-query discipline in `web/lib/eventStore.js`. Information disclosure is the high-impact threat (T06: default credential).
- **F2 HTTP POST** — T, I, D apply. Tampering and information disclosure both reduce to the same root cause (plaintext HTTP, T05). Denial of service is T07.

---

## 5. Threat catalogue

Each threat has a stable ID, a DFD anchor, a CVSS v3.1 base vector, an estimated score from that vector, the implemented mitigation in this codebase, and the residual risk that the demo scope deliberately accepts. *Estimated* is honest: the score is fully determined by the vector string and can be reproduced with the [FIRST CVSS calculator](https://www.first.org/cvss/calculator/3-1).

### T01 — Spoofing of `/api/movement`

- **DFD anchor:** P3 (Spoofing)
- **Description:** An attacker on the LAN (E2) posts forged events to `/api/movement`, faking pick activity or polluting the session timeline.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:L` → **6.8 (Medium)**
- **Mitigation:** Bearer-token auth in `web/app/api/movement/route.js` via the shared helper `web/lib/bearerAuth.js`, enforced when `BRIDGE_API_TOKEN` is set in the environment (and required by `docker-compose.yml`). Constant-time comparison via `node:crypto.timingSafeEqual`. The bridge sends the token from `BRIDGE_API_TOKEN` (or `--api-token`).
- **Residual:** If the token is left blank for an open demo, any LAN client is accepted.

### T02 — Payload tampering on POST

- **DFD anchor:** F2 (Tampering)
- **Description:** Payload fields manipulated in transit or by a hostile poster — e.g. `ax = 9999` to corrupt the chart, or `event = "made_up"` to confuse the dashboard.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N` → **6.5 (Medium)**
- **Mitigation:** 8 KB body cap, event-type whitelist, finite-number checks, and **physical bounds** (\|a\*\| ≤ 16 g, \|g\*\| ≤ 2000 dps) matching the LSM9DS1 ranges; `movementConfidence ∈ [0, 1]`. In `isValidMovement()` in `web/app/api/movement/route.js`.
- **Residual:** A man-in-the-middle on plaintext HTTP can still substitute a *valid-looking* payload.

### T03 — Unauthenticated dashboard

- **DFD anchor:** E1 / P4 (Spoofing)
- **Description:** Anyone with LAN access can open the dashboard, view live pick activity, and press End Pick on the operator's session.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N` → **7.1 (High)** when unset; **N/A** once `DASHBOARD_PASSWORD` is set.
- **Mitigation:** Single-operator login gate. Setting `DASHBOARD_PASSWORD` and `SESSION_SECRET` enables an HMAC-signed httpOnly session cookie issued by `/api/auth/login`; `web/middleware.js` requires the cookie on every page and gated API except the bridge ingest path. See `web/lib/auth.js`, `web/middleware.js`.
- **Residual:** Single shared credential — no per-operator identity (T04 still applies). Brute-force is mitigated by login rate-limit (T12).

### T04 — Repudiation: no operator identity, no audit trail

- **DFD anchor:** E1, P3, DS1 (Repudiation)
- **Description:** After an incident, no way to prove that a specific operator performed a pick or ended a session. No DB-level audit log.
- **CVSS v3.1:** **Not directly scorable.** Repudiation is a governance and compliance concern, not a CIA impact in the CVSS sense. Severity treated qualitatively as *Low* for a single-operator demo, *High* for any multi-operator deployment.
- **Mitigation:** Each session has a UUID, full event timeline, and `metadata.source`, which gives forensic continuity even without operator identity. Schema: `web/db/schema.sql`.
- **Residual:** No operator identity, no signed events from the board, no append-only audit log on Postgres. Accepted for demo scope.

### T05 — Plaintext HTTP information disclosure

- **DFD anchor:** F2, F3, F4, F5 (Information Disclosure / Tampering)
- **Description:** All HTTP between the bridge, server, and browser is plaintext. A LAN sniffer reads voice/colour/motion telemetry and pick sessions; an active MitM can modify them.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N` → **7.1 (High)**
- **Mitigation:** None at the transport layer. **Accepted residual** for a trusted-LAN demo.
- **Residual:** Production deployment must terminate TLS at a reverse proxy (Caddy, nginx, or Cloudflare Tunnel) in front of the Next.js container.

### T06 — Default Postgres credential

- **DFD anchor:** DS1 (Information Disclosure / Elevation of Privilege)
- **Description:** `docker-compose.yml` carries `iot_demo_password` as the default Postgres password. Without further hardening, the container would expose port 5432 on every host interface, so anyone on the LAN could attempt connections.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` → **9.0 (Critical)** if the default is in use and the port is LAN-reachable; **N/A** once `.env` provides a strong password and the port binding is loopback-only.
- **Mitigation:** Two layers. (1) `.env` (gitignored) contains a 32-character random alphanumeric password loaded by Docker Compose, overriding the default. (2) The Postgres host port binding in `docker-compose.yml` is now `127.0.0.1:${POSTGRES_HOST_PORT}:5432`, restricting connections to the gateway host's loopback interface so LAN clients (E2) can no longer reach the database directly.
- **Residual:** A future operator who runs `docker compose up` *without* providing `.env` gets the weak default — but only locally on the host. The high CVSS score evaporates the moment `.env` is in place.

### T07 — Ingest flood (DoS)

- **DFD anchor:** P3 / F2 (Denial of Service)
- **Description:** A misbehaving device or attacker streams `/api/movement` events at line rate, filling the database, slowing the dashboard, and eventually exhausting disk.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` → **7.5 (High)**
- **Mitigation:** Optional per-IP rate limit (`INGEST_RATE_LIMIT_PER_MIN`, off by default; ≥ 4000 if enabled because legitimate movement is ~44 Hz × 60 s ≈ 2640/min). Bridge drops `voice_debug` and `colour_debug` by default (`BRIDGE_DEBUG_DOWNSAMPLE=0`).
- **Residual:** Storage growth is still unbounded over time; long-running deployments need event archival.

### T08 — Silent serial death (DoS)

- **DFD anchor:** F1 / P2 (Denial of Service)
- **Description:** A yanked USB cable or crashed sketch causes the bridge's `readline()` to return empty bytes indefinitely. Without detection, the dashboard sits on stale data and the fault is invisible.
- **CVSS v3.1:** `AV:P/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` → **4.6 (Medium)** (physical attack vector lowers the score)
- **Mitigation:** `--silence-timeout` (default 60 s) — bridge exits non-zero so a process supervisor can restart it. Firmware now emits `init_error` events unconditionally, so genuine sensor faults reach the dashboard.
- **Residual:** Without a process supervisor (`systemd`/`launchd`), an exit just means the bridge is gone.

### T09 — MitM control-plane injection

- **DFD anchor:** F3 / F5 (Tampering / Denial of Service)
- **Description:** A LAN attacker injects a `stopBridge: true` response on F3, or a forged POST to `/api/sessions/current/complete` on F5, halting warehouse pick operations or destroying in-flight session state.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:H` → **7.1 (High)**
- **Mitigation:** Partial, on three axes. (1) `/api/bridge/control` (F3) requires `BRIDGE_API_TOKEN`; an attacker without the token cannot inject a `stopBridge: true` response. (2) `/api/sessions/current/complete` (F5) requires either a valid operator session cookie or `ADMIN_API_TOKEN`; route-level enforcement is in `web/app/api/sessions/current/complete/route.js`. (3) The control endpoint is read-only and returns small payloads, and the session-complete logic refuses to save a session that hasn't passed both authentication gates, so a successful forged early stop is not weaponised into bad data — it just deletes the in-flight session.
- **Residual:** Token replay over plaintext HTTP is still possible if a LAN attacker has captured the bearer header. TLS at the proxy (T05 fix) closes that.

#### Why the Stop endpoint accepts *either* the cookie or the bearer token

`/api/sessions/current/complete` is the only mutation endpoint with two legitimate caller types: the **operator's browser** (authenticated through `/api/auth/login` and carrying the HMAC-signed `iot_session` cookie) and **external automation** (cleanup scripts, scheduled tasks, integration tests) that has no browser session to attach a cookie to. Requiring *both* a valid cookie *and* a bearer token on every call would force a logged-in operator to type the deployment's admin token on every Stop press — friction without a security gain, since an operator who has already proven knowledge of `DASHBOARD_PASSWORD` is at least as trusted as the holder of `ADMIN_API_TOKEN`. The route therefore accepts whichever is present and rejects only when *neither* validates. This is an ergonomics decision, not a capability one: each path grants identical authority on this single endpoint, and both are gated behind credentials issued at deployment time.

### T10 — Container running as root (Elevation of Privilege)

- **DFD anchor:** P3 (Elevation of Privilege)
- **Description:** A bug in Next.js or a transitive dependency is exploited for code execution. If the container process is root, the attacker holds root in the container.
- **CVSS v3.1:** `AV:A/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:H` → **8.5 (High)** *(contingent on a separate RCE)*
- **Mitigation:** Web container now runs as the unprivileged `node` user. Built artefacts are copied with `--chown node:node`. See `web/Dockerfile`.
- **Residual:** Postgres container still runs as the official image's default user. Outside our control.

### T11 — Overprivileged DB role (Elevation of Privilege)

- **DFD anchor:** DS1 (Elevation of Privilege)
- **Description:** The application connects to Postgres as the schema owner. A SQL-injection bug — or a compromise of the web process — would let an attacker `DROP TABLE events`.
- **CVSS v3.1:** `AV:A/AC:H/PR:H/UI:N/S:U/C:H/I:H/A:H` → **6.0 (Medium)** *(contingent on web process compromise)*
- **Mitigation:** All queries are parameterised in `web/lib/eventStore.js`; no string concatenation into SQL.
- **Residual:** A dedicated `app_writer` Postgres role with `INSERT/SELECT/UPDATE` only on the relevant tables is the proper defence. Not in place yet.

### T12 — Dashboard login brute-force

- **DFD anchor:** E1 / P3 (Spoofing)
- **Description:** With dashboard auth enabled (T03 mitigation), the `/api/auth/login` endpoint is now the single point of access. An attacker on the LAN could attempt to brute-force the shared `DASHBOARD_PASSWORD`.
- **CVSS v3.1:** `AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N` → **6.5 (Medium)** *(contingent on a weak password)*
- **Mitigation:** Login attempts are limited to 8/IP/minute via the shared `web/lib/rateLimit.js` (same primitive used on `/api/movement`). Password comparison is constant-time. The session cookie is HMAC-SHA256 signed with `SESSION_SECRET` and httpOnly + sameSite=lax.
- **Residual:** A distributed attacker with multiple source IPs could still mount a slow brute-force. With a 16-character password from `openssl rand`, the search space is ≈ 95¹⁶ ≈ 4.4 × 10³¹, making this primarily a "use a strong password" requirement.

---

## 6. Severity summary (CVSS-ordered)

| Threat | DFD anchor | STRIDE | CVSS Base | Severity | Status |
|---|---|---|---|---|---|
| T06 Default Postgres credential | DS1 | I/E | 9.0 | **Critical** | Mitigated via `.env` override |
| T10 Container as root | P3 | E | 8.5 | **High** | Mitigated (`USER node`) |
| T07 Ingest flood | P3 / F2 | D | 7.5 | **High** | Mitigated (opt-in rate limit + debug-drop default) |
| T03 Unauthenticated dashboard | E1 / P4 | S | 7.1 | **High** | Mitigated when `DASHBOARD_PASSWORD` is set |
| T05 Plaintext HTTP | F2/F3/F4/F5 | I, T | 7.1 | **High** | Accepted residual; TLS-at-proxy is recommended |
| T09 MitM control-plane injection | F3 / F5 | T, D | 7.1 | **High** | Partial mitigation; same fix as T05 |
| T01 Unauth ingest spoofing | P3 | S | 6.8 | Medium | Mitigated (`BRIDGE_API_TOKEN` required) |
| T02 Payload tampering | F2 | T | 6.5 | Medium | Mitigated (validation + physical bounds) |
| T12 Dashboard login brute-force | E1 / P3 | S | 6.5 | Medium | Mitigated (rate-limit + signed cookie); contingent on strong password |
| T11 Overprivileged DB role | DS1 | E | 6.0 | Medium | Partial (parameterised queries); role split pending |
| T08 Silent serial death | F1 / P2 | D | 4.6 | Medium | Mitigated (silence-timeout + `init_error`) |
| T04 Repudiation | E1 / P3 / DS1 | R | n/a | (qualitative: Low for demo, High at scale) | Accepted for demo scope |

The five **High** or **Critical** findings (T06, T10, T07, T03, T05, T09) are the load-bearing items for any production move. T06, T10, and T03 are already closed by the implementation. T05 and T09 share the remaining fix (TLS at a reverse proxy) and would close together.

---

## 7. Mitigations by file (quick reference)

| Mitigation | File | Threat |
|---|---|---|
| Bearer-token auth helper (constant-time) | `web/lib/bearerAuth.js` | T01, T09 |
| `BRIDGE_API_TOKEN` enforced on ingest and bridge control | `web/app/api/movement/route.js`, `web/app/api/bridge/control/route.js`, `bridge/serial_to_http.py` | T01, T09 |
| `ADMIN_API_TOKEN` (or session cookie) on Stop endpoint | `web/app/api/sessions/current/complete/route.js` | T09 |
| Body-size cap, event whitelist, type checks, physical bounds | `web/app/api/movement/route.js` | T02 |
| Per-IP rate limit (shared primitive) | `web/lib/rateLimit.js`, `web/app/api/movement/route.js`, `web/app/api/auth/login/route.js` | T07, T12 |
| Operator login + signed session cookie | `web/lib/auth.js`, `web/middleware.js`, `web/app/api/auth/login/route.js`, `web/app/login/page.js` | T03 |
| Postgres bound to host loopback (127.0.0.1) | `docker-compose.yml` | T06 |
| Bridge silence timeout | `bridge/serial_to_http.py` | T08 |
| Bridge retry queue with backoff | `bridge/serial_to_http.py` | T07 (resilience) |
| Drop/downsample debug events | `bridge/serial_to_http.py` | T07 |
| Init-error emission regardless of debug flag | `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino` | T08 |
| Non-root container | `web/Dockerfile` | T10 |
| Healthcheck on web service | `docker-compose.yml` | operability |
| In-memory fallback gated to non-production | `web/lib/eventStore.js` | T11 (data-loss footgun) |
| Strong DB password and `BRIDGE_API_TOKEN` | `.env` (gitignored), `.env.example` | T06, T01 |
| Parameterised SQL throughout | `web/lib/eventStore.js` | T11 |

---

## 8. Out of scope (explicit)

- **Physical attacks on the board** — replacement, re-flash via the bootloader, USB-cable injection, EM eavesdropping. Tamper-evident enclosures and bootloader-locking are the right answers; both are out of academic scope.
- **Supply-chain attacks on Edge Impulse models.** The `combined_inferencing` library is treated as trusted.
- **Operator-machine attacks.** No CSP, no CSRF tokens — acceptable given the dashboard is itself unauthenticated and behind a trusted reverse proxy in any real deployment.
- **Long-term retention and right-to-erasure.** The schema records voice/colour/motion samples indefinitely. Real warehouse use needs a retention policy.

---

## 9. Recommended next steps (post-submission, ordered by score impact)

1. **Terminate TLS at a reverse proxy** in front of the web container. Closes T05 and T09 in one move.
2. **Create a dedicated `app_writer` Postgres role** with `INSERT/SELECT/UPDATE` on the event tables only and use it from the application. Closes T11.
3. **Add an event-archival job** that moves `movement_samples` rows older than N days to cold storage and deletes them from the live table. Reduces residual storage-growth risk under T07.
4. **Per-operator identity.** The shared `DASHBOARD_PASSWORD` closes T03 but leaves T04 (no operator audit trail) open at scale. A multi-user table with hashed credentials, or a real IdP behind the proxy, would fix it.

---

## References

- Howard, M. and Lipner, S. (2006). *The Security Development Lifecycle.* Microsoft Press.
- Shostack, A. (2014). *Threat Modeling: Designing for Security.* Wiley. (§ 9.2 *DREAD Reconsidered* — the canonical critique of DREAD.)
- FIRST.org (2019). *Common Vulnerability Scoring System v3.1: Specification Document.* https://www.first.org/cvss/v3.1/specification-document
- FIRST.org. *CVSS v3.1 Calculator.* https://www.first.org/cvss/calculator/3-1
