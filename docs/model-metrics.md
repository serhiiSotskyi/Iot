# Model Performance Metrics

> **This is a template you must fill in from your three Edge Impulse Studio projects.**
> The numbers below are placeholders. Do not submit it as-is. Each section ends with **"How to find this in Edge Impulse Studio"** so you know exactly where each metric lives.

The system runs three TinyML models on the Nano 33 BLE Sense, served through one combined Arduino library. Each model is documented separately. For each model, fill in:

1. **Training-data description** — what the model was taught.
2. **Test-set performance** — how well it generalises (accuracy, F1, per-class precision/recall).
3. **Confusion matrix** — *which* classes the model confuses.
4. **On-device performance** — inference time, RAM, flash usage on the Cortex-M4.

> **How to find this in Edge Impulse Studio** (applies to every model):
> - Training-data description: *Data acquisition* tab — counts and class balance, plus the per-sample length and sampling rate.
> - Accuracy / F1 / confusion matrix: *NN Classifier* (or *Classifier*) tab → **Model testing** section, after running "Classify all".
> - On-device performance: bottom of the *NN Classifier* tab → **EON Tuner / Performance**, look for "On-device performance" with the Cortex-M4F target selected.

---

## Model 1 — Voice keyword model (Edge Impulse project `970121`)

Detects the keyword **"start"** in continuous audio captured from the on-board PDM microphone. Runs in **continuous-inference mode** (`run_classifier_continuous`) at 16 kHz.

### Training data

| Field | Value |
|---|---|
| Sample rate | `16000` Hz |
| Window length | _e.g._ `1000` ms |
| Window stride | _e.g._ `500` ms |
| Classes | `start`, `unknown` |
| Total samples (train) | _fill in_ |
| Total samples (test) | _fill in_ |
| Class balance (train) | _start: __ / unknown: __, in seconds_ |
| Augmentation | _e.g. noise, time-shift — list what was enabled in the impulse_ |
| DSP block | MFE / MFCC (record which) |
| Source | _e.g. team-recorded utterances + EI's "noise" dataset_ |

### Test-set performance

| Metric | Value |
|---|---|
| Accuracy | _ % |
| F1 (macro) | _ |
| Precision: `start` | _ |
| Recall: `start` | _ |
| Precision: `unknown` | _ |
| Recall: `unknown` | _ |

### Confusion matrix

|  | predicted `start` | predicted `unknown` |
|---|---|---|
| actual `start` | _TP_ | _FN_ |
| actual `unknown` | _FP_ | _TN_ |

### On-device performance (Cortex-M4F @ 64 MHz)

| Metric | Value |
|---|---|
| Inference time | _ ms per window |
| Peak RAM usage | _ KB |
| Flash usage | _ KB |
| Quantisation | int8 / float32 (record which) |

### Operating thresholds in firmware

These come straight from `arduino/voice_colour_motion_demo/voice_colour_motion_demo.ino`:

- `VOICE_START_THRESHOLD = 0.75` — minimum confidence to declare a positive `start`.
- `VOICE_RELEASE_THRESHOLD = 0.35` — confidence must drop below this to re-arm.
- `VOICE_REQUIRED_STREAK = 1` — number of consecutive positive windows required.
- `VOICE_ARM_DELAY_MS = 4000` — startup grace period to suppress boot-noise false positives.

> **Trade-off worth flagging in the report.** `VOICE_REQUIRED_STREAK = 1` was chosen for demo reliability — it means a single high-confidence detection passes the gate. Production would use `≥ 3` with the threshold tightened, accepting a slower trigger for far fewer false positives.

---

## Model 2 — Colour / package-tag model (Edge Impulse project `970107`)

Classifies a four-channel colour reading from the APDS-9960 (R, G, B, clear) into a tag colour. The firmware uses this to **verify a package tag** before allowing handling.

### Training data

| Field | Value |
|---|---|
| Sample rate | per-read (single 4-feature vector, not a time series) |
| Window length | n/a — one reading per inference |
| Classes | `red`, `green`, `blue`, `other` |
| Total samples (train) | _fill in_ |
| Total samples (test) | _fill in_ |
| Class balance | _red: __ / green: __ / blue: __ / other: __ |
| Source | _team-collected APDS-9960 readings under warehouse-representative lighting_ |
| Pre-processing | raw → `ch1=r`, `ch2=g`, `ch3=b`, `ch4=clear` (matches firmware feature order) |

### Test-set performance

| Metric | Value |
|---|---|
| Accuracy | _ % |
| F1 (macro) | _ |
| Precision per class | red _ / green _ / blue _ / other _ |
| Recall per class    | red _ / green _ / blue _ / other _ |

### Confusion matrix

|  | pred red | pred green | pred blue | pred other |
|---|---|---|---|---|
| actual red | _ | _ | _ | _ |
| actual green | _ | _ | _ | _ |
| actual blue | _ | _ | _ | _ |
| actual other | _ | _ | _ | _ |

### On-device performance

| Metric | Value |
|---|---|
| Inference time | _ ms per reading |
| Peak RAM usage | _ KB |
| Flash usage | _ KB |
| Quantisation | _ |

### Operating thresholds in firmware

- `COLOUR_GREEN_THRESHOLD = 0.70` — confidence needed for the *green* class to authenticate a package tag. Other classes are not used as authentication paths.

> **Limitation worth mentioning.** The model was trained against a specific lighting condition. Sensitivity to ambient light is the most likely failure mode in a real warehouse and should be addressed with active illumination (the APDS-9960 has an LED) or a multi-condition training set.

---

## Model 3 — Handling-motion model (Edge Impulse project `928825`)

Classifies a 2-second IMU window into a motion direction class. Used after a package tag is verified to track how the operator handles the package.

### Training data

| Field | Value |
|---|---|
| Sample rate | `44` Hz (firmware sample interval `MOVEMENT_MODEL_SAMPLE_INTERVAL_MS ≈ 22.7` ms) |
| Window length | `88` samples × 3 axes (≈ 2 s) |
| Axes used | accelerometer x, y, z — **converted from `g` to m/s²** in firmware before inference |
| Classes | `up`, `down`, `left`, `right`, `idle` |
| Total samples (train) | _fill in_ |
| Total samples (test) | _fill in_ |
| Class balance | _up: __ / down: __ / left: __ / right: __ / idle: __ |
| Augmentation | _record what was enabled (jitter, scaling, etc.)_ |
| DSP block | Spectral / Flatten / Raw (record which) |

### Test-set performance

| Metric | Value |
|---|---|
| Accuracy | _ % |
| F1 (macro) | _ |
| Precision per class | up _ / down _ / left _ / right _ / idle _ |
| Recall per class    | up _ / down _ / left _ / right _ / idle _ |

### Confusion matrix

|  | pred up | pred down | pred left | pred right | pred idle |
|---|---|---|---|---|---|
| actual up | _ | _ | _ | _ | _ |
| actual down | _ | _ | _ | _ | _ |
| actual left | _ | _ | _ | _ | _ |
| actual right | _ | _ | _ | _ | _ |
| actual idle | _ | _ | _ | _ | _ |

### On-device performance

| Metric | Value |
|---|---|
| Inference time | _ ms per 2 s window |
| Peak RAM usage | _ KB |
| Flash usage | _ KB |
| Quantisation | _ |

### Feature pipeline in firmware

- IMU read at ~44 Hz into a circular buffer of size `88` (= 2 s of history).
- On every full window, units are converted from `g` to `m/s²` before being passed to `run_classifier`.
- The output is reported on the dashboard as the "Package handling motion" class plus its confidence.

---

## Combined-model footprint

| Resource | Voice | Colour | Movement | **Total** |
|---|---|---|---|---|
| Flash (KB) | _ | _ | _ | _ |
| RAM (KB) | _ | _ | _ | _ |
| Worst-case inference time (ms) | _ | _ | _ | _ |

> **How to find this**: the per-model Flash/RAM is on each EI project page. The combined-library footprint is in the Arduino IDE compile output: look for the line *"Sketch uses N bytes of program storage space..."* and *"Global variables use N bytes of dynamic memory..."* after building `voice_colour_motion_demo.ino`.

The Nano 33 BLE Sense's nRF52840 has **1 MB flash** and **256 KB RAM**, so the headroom you have left is `1024 KB − total flash` and `256 KB − total RAM`.

---

## Reporting checklist for the submission

- [ ] Replace every `_` placeholder with a real number.
- [ ] Note the date the test set was evaluated and the EI project version (top right of each project page).
- [ ] Mention class imbalance explicitly if any class has fewer than ~30 % of the average sample count.
- [ ] If accuracy is high but one class has poor recall, say so — assessors look for honest discussion of weaknesses, not just headline accuracy.
- [ ] Cross-reference the firmware thresholds (`VOICE_START_THRESHOLD`, `COLOUR_GREEN_THRESHOLD`) with the operating point on the precision/recall curve in EI Studio. The threshold is a deployment choice, not a training-time choice, and noting it shows you understand the difference.
