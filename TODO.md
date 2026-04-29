# Pre-submission TODO

Each item here closes a specific gap that costs marks if left undone. Order is rough impact-per-hour.

---

## 1. Fill in `docs/model-metrics.md` — **highest leverage, ~1–2 h total**

Each group member owns the metrics for the model they trained. The
template at `docs/model-metrics.md` already has the four sections per
model and tells you exactly where each metric lives in Edge Impulse
Studio. The numbers below must come from EI Studio with screenshots
saved into `screenshots/personal/<member>/`.

### Per-member ownership

| Member | Section to fill | EI project |
|---|---|---|
| **Serhii Sotskyi** | "Model 1 — Voice keyword model" | `970121` |
| **Artiom Gutu** | "Model 2 — Colour authentication model" | `970107` |
| **Joel Shore** | "Model 3 — Movement model" | `928825` |

### Steps for each member (15–25 min)

1. Open your EI Studio project.
2. **Data acquisition** tab → record the per-class sample counts and total seconds/samples. Screenshot the dataset overview.
3. **NN Classifier** (or **Classifier**) tab → click *"Classify all"* on the test set. Record:
   - Accuracy, F1 (macro), per-class precision/recall.
   - Confusion matrix (numbers, not just the heatmap).
   - Screenshot the confusion matrix.
4. Same tab → scroll to **On-device performance**. Confirm the target is **Cortex-M4F 64 MHz** (the Nano 33 BLE Sense's chip). Record:
   - Inference time (ms).
   - Peak RAM (kB).
   - Flash usage (kB).
   - Screenshot the on-device performance panel.
5. Save screenshots to `screenshots/personal/<your-name>/` and reference them in your section of `docs/model-metrics.md`.
6. Replace every `_fill in_` in your section with the values above.

When all three members are done, add a one-line "Last filled in: YYYY-MM-DD by <member>" footer to `docs/model-metrics.md`.

---

## 2. Verify the TinyML report matches current code — **30 min**

The report in `reports/tinyml_iot_demo_report.{docx,pdf}` is generated
from `reports/build_tinyml_iot_report.py`. Three claims in that script
are now slightly out of date and should be reconciled before submitting
the PDF.

### Discrepancy 1 — Stop endpoint auth

**Script line 591** says:
> "POST /api/sessions/current/complete requires ADMIN_API_TOKEN when configured."

**Reality:** the route now accepts *either* a valid session cookie *or* `ADMIN_API_TOKEN`. The dashboard uses the cookie path; external scripts use the bearer.

**Fix:** edit line 591 in `build_tinyml_iot_report.py` to read approximately:
> "POST /api/sessions/current/complete requires either a valid operator session cookie or ADMIN_API_TOKEN. The dashboard uses the cookie path issued by /api/auth/login; external automation uses the bearer token. Section 5.X of docs/threat-model.md justifies the dual-path design."

### Discrepancy 2 — admin token prompt

**Script line 607** says:
> "The dashboard prompts for the admin token on the first protected stop action and stores it in browser localStorage for the demo operator."

**Reality:** the prompt was removed. The dashboard now uses the session cookie silently — no token typing.

**Fix:** edit line 607 to read approximately:
> "The dashboard does not need to type any token; once the operator has logged in via /login, the signed session cookie alone authorises the Stop action."

### Discrepancy 3 — `INGEST_TOKEN`

The script doesn't reference `INGEST_TOKEN` directly, but if you regenerate the PDF, double-check that no figure or caption mentions it.

### How to regenerate the PDF + DOCX

```bash
cd reports
python -m venv .venv && source .venv/bin/activate
pip install python-docx Pillow reportlab    # whatever it imports — read the script header
python build_tinyml_iot_report.py
```

Inspect the new `tinyml_iot_demo_report.pdf`, commit the regenerated artefacts.

---

## 3. Record a 30–60 second demo video — **20 min**

A short demo video is the single most efficient piece of evidence you can hand a remote marker. Record one full pick session from board reset to "End pick session", screen-share the dashboard so all three classifications appear in real time. Save as `demo.mp4` in the repo root (or upload to a private link and reference it in README).

Suggested narration script:

1. *"Reset the board — dashboard shows 'Sensor node booted'."*
2. *"Wait 4 seconds for arm — the bridge is buffering."*
3. *"Say 'start' — dashboard shows 'Operator scan command armed'."*
4. *"Hold the green tag in front of the APDS-9960 — dashboard shows 'Package tag verified'."*
5. *"Move the board up, down, left, right — chart updates in real time."*
6. *"Click End pick session — session saved to recorded list, replay available."*

Add to `README.md` § Run it under a new "Demo video" subheading.

---

## 4. Run the verification suite — **5 min**

After the next deploy, run `./verify.sh` against your running stack to confirm every auth boundary holds. The script lives at the repo root (added in this commit) and asserts:

- Unauthed page request → redirect to `/login`
- Login with wrong password → 401
- Login with correct password → 200 + `Set-Cookie`
- `POST /api/movement` without bearer → 401
- `POST /api/movement` with `BRIDGE_API_TOKEN` → 200
- `POST /api/sessions/current/complete` with no auth → 401
- `POST /api/sessions/current/complete` with `ADMIN_API_TOKEN` → 200

```bash
./verify.sh http://localhost:3001
```

If any check fails, that is a real regression — fix before submitting.

---

## 5. Final checklist before push

- [ ] Model metrics filled in for all three models (item 1)
- [ ] Report PDF regenerated with corrections (item 2)
- [ ] Demo video committed or linked in README (item 3)
- [ ] `./verify.sh` passes against deployed stack (item 4)
- [ ] `git status` clean on `main`
- [ ] All members listed in `CONTRIBUTORS.md` confirm their entry is correct
- [ ] No secrets committed (`grep -r "BRIDGE_API_TOKEN=" --include="*.md"` should not show real values)

When the checklist is green, push to `origin/main` and submit.
