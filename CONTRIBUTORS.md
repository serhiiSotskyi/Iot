# Contributors

This is a three-person group project. Each member trained one of the three
on-device Edge Impulse models on their own EI Studio account, exported it,
and contributed the export to this repository. The firmware in
`arduino/voice_colour_motion_demo/` then loads all three through a single
combined inferencing library at `arduino/libraries/combined_inferencing/`.

## Per-author model contributions

| Member | Model | EI project ID | Labels | Sensor / sample rate | Export folder in this repo |
|---|---|---|---|---|---|
| **Serhii Sotskyi** | Voice keyword spotting | `970121` (Impulse #1) | `start`, `unknown` | PDM microphone, 16 kHz, 1 s window | `serhiisotskyi-project-1_inferencing/` |
| **Artiom Gutu** *(EI handle: `pepstee`)* | Package-tag colour classification | `970107` (Impulse #1) | `blue`, `green`, `other`, `red` | APDS-9960 RGB sensor, 4-channel single sample | `pepstee-project-1_inferencing/` |
| **Joel Shore** | IMU motion classification | `928825` (Impulse #8) | `down`, `idle`, `left`, `right`, `up` | LSM9DS1 accelerometer, 44 Hz, 88-sample window | `joelshore-project-1-cpp-mcu-v1-impulse-#8/` |

Each EI export is the unmodified output of the **Build → Arduino library**
(or **C++ MCU** for Joel's variant) action in Edge Impulse Studio. Anyone
with markers' access to those Studio projects can verify authorship,
training set, and validation metrics directly from the IDs above.

## Why three separate exports are kept in the repo

Edge Impulse exports each project as a self-contained library bundling
the SDK, the model parameters, and the TFLite weights. Adding all three
exports to the Arduino IDE as parallel libraries fails to compile because
they share SDK symbols (see `docs/design-decisions.md` § 3 for the long
form).

The fix is the **combined library** at
`arduino/libraries/combined_inferencing/`, which contains:

- **One** copy of the Edge Impulse SDK (deduplicated across exports).
- **Three** sets of model parameters and TFLite weights, namespaced by
  EI project ID so the impulse handles don't collide.

The firmware then calls each impulse explicitly:

```cpp
run_classifier_image_quantized(&signal, &result, false, 970121, ...);  // voice
run_classifier_image_quantized(&signal, &result, false, 970107, ...);  // colour
run_classifier_image_quantized(&signal, &result, false, 928825, ...);  // motion
```

The original per-author exports are retained at the repository root as
**evidence of individual contribution** — each folder is the exact
artefact the named member produced and committed. Removing them would
erase that evidence.

## Repository layout note

Joel's export is a **C++ MCU** target rather than an Arduino library.
The full export (SDK, model parameters, TFLite weights, `CMakeLists.txt`,
`README.txt`) lives self-contained inside
`joelshore-project-1-cpp-mcu-v1-impulse-#8/` and is unrelated to the
production firmware build, which runs out of
`arduino/libraries/combined_inferencing/`.

## Other contributions

Contribution attribution beyond the EI models is recorded in `git log`:
firmware sketch, Python serial-to-HTTP bridge, Next.js dashboard, threat
model, architecture documentation, diagrams, and report were divided
between members and are visible in commit history (`git log --author=...`).
