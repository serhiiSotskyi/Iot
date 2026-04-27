/*
 * voice_colour_motion_demo.ino
 *
 * Arduino Nano 33 BLE / Nano 33 BLE Sense demo firmware.
 *
 * State flow:
 *   WAITING_FOR_VOICE  -> Edge Impulse voice model detects "start"
 *   WAITING_FOR_COLOUR -> Edge Impulse colour model detects "green"
 *   TRACKING_MOVEMENT  -> Edge Impulse movement model classifies board motion
 *
 * The board has no WiFi. It prints JSON lines to USB Serial at 115200 baud.
 * The Python bridge reads those lines and forwards them to the web app.
 */

#include <Arduino_APDS9960.h>
#include <Arduino_LSM9DS1.h>
#include <PDM.h>
#include <string.h>

#define EIDSP_QUANTIZE_FILTERBANK 0

#include <combined_inferencing.h>

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

static const bool DEBUG_SERIAL = false;
static const bool EMIT_SETUP_STATUS = true;
static const bool EMIT_VOICE_DEBUG = true;
static const bool EMIT_COLOUR_DEBUG = true;

static const float VOICE_START_THRESHOLD = 0.75f;
static const float VOICE_RELEASE_THRESHOLD = 0.35f;
static const unsigned long VOICE_TRIGGER_COOLDOWN_MS = 2000;
static const unsigned long VOICE_DEBUG_INTERVAL_MS = 500;
static const unsigned long VOICE_ARM_DELAY_MS = 4000;
static const int VOICE_REQUIRED_STREAK = 1;

static const float COLOUR_GREEN_THRESHOLD = 0.70f;
static const int COLOUR_REQUIRED_STREAK = 3;
static const unsigned long COLOUR_DEBUG_INTERVAL_MS = 300;

static const unsigned long MOVEMENT_OUTPUT_INTERVAL_MS = 250;
static const float MOVEMENT_DIRECTION_THRESHOLD = 0.60f;
static const float CONVERT_G_TO_MS2 = 9.80665f;

enum SystemState {
  WAITING_FOR_VOICE,
  WAITING_FOR_COLOUR,
  TRACKING_MOVEMENT
};

typedef struct {
  signed short *buffers[2];
  unsigned char buf_select;
  unsigned char buf_ready;
  unsigned int buf_count;
  unsigned int n_samples;
} inference_t;

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

static SystemState currentState = WAITING_FOR_VOICE;

static bool voiceReady = false;
static bool colourReady = false;
static bool imuReady = false;

static inference_t inference;
static bool recordReady = false;
static signed short *sampleBuffer = nullptr;
static bool debug_nn = false;

static bool voiceTriggerLatched = false;
static unsigned long lastVoiceTriggerMs = 0;
static unsigned long lastVoiceDebugMs = 0;
static unsigned long voiceArmStartMs = 0;
static int voiceStartStreak = 0;

static int greenStreak = 0;
static unsigned long lastColourDebugMs = 0;

static float movementRing[MOVEMENT_MODEL_INPUT_FRAME_SIZE] = {0.0f};
static float movementInferenceBuffer[MOVEMENT_MODEL_INPUT_FRAME_SIZE] = {0.0f};
static uint16_t movementWriteSample = 0;
static uint16_t movementSampleCount = 0;
static unsigned long lastMovementSampleUs = 0;
static unsigned long lastMovementOutputMs = 0;

static float latestAx = 0.0f;
static float latestAy = 0.0f;
static float latestAz = 0.0f;
static float latestGx = 0.0f;
static float latestGy = 0.0f;
static float latestGz = 0.0f;

// ---------------------------------------------------------------------------
// Required public helpers
// ---------------------------------------------------------------------------

bool voiceDetectedStart();
bool greenDetected();
void sendMovementData();
void printJsonEvent(const char* eventName);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

static void debugLog(const char* message);
static bool initVoiceModule();
static bool initColourModule();
static bool initImuModule();
static void stopVoiceModule();
static void resetMovementBuffer();
static bool readColourSample(int &r, int &g, int &b, int &clearValue);
static bool readMovementSample();
static bool buildMovementInferenceBuffer();
static float findClassificationValue(const ei_impulse_result_t &result, size_t labelCount, const char *label);
static const char* findTopClassification(
  const ei_impulse_result_t &result,
  size_t labelCount,
  float &confidence
);
static const char* stateName(SystemState state);
static void printJsonBool(bool value);
static void printSetupStatus();
static void printVoiceDebug(const ei_impulse_result_t &result);
static void printColourDebug(
  int r,
  int g,
  int b,
  int clearValue,
  const ei_impulse_result_t &result,
  bool greenNow,
  float greenConfidence,
  const char *topLabel,
  float topConfidence
);
static void printColourError(int r, int g, int b, int clearValue, int status);
static void pdmDataReadyInferenceCallback();
static bool microphoneInferenceStart(uint32_t n_samples);
static bool microphoneInferenceRecord();
static int microphoneAudioSignalGetData(size_t offset, size_t length, float *out_ptr);
static void microphoneInferenceEnd();

// ---------------------------------------------------------------------------
// Arduino lifecycle
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  unsigned long serialWaitStart = millis();
  while (!Serial && (millis() - serialWaitStart) < 3000) {
    delay(10);
  }

  voiceReady = initVoiceModule();
  colourReady = initColourModule();
  imuReady = initImuModule();
  voiceArmStartMs = millis();

  if (EMIT_SETUP_STATUS) {
    printSetupStatus();
  }
}

void loop() {
  switch (currentState) {
    case WAITING_FOR_VOICE:
      if (voiceDetectedStart()) {
        printJsonEvent("voice_start");
        stopVoiceModule();
        currentState = WAITING_FOR_COLOUR;
      }
      break;

    case WAITING_FOR_COLOUR:
      if (greenDetected()) {
        Serial.println("{\"event\":\"colour_authenticated\",\"colour\":\"green\"}");
        resetMovementBuffer();
        currentState = TRACKING_MOVEMENT;
      }
      break;

    case TRACKING_MOVEMENT:
      sendMovementData();
      break;
  }
}

// ---------------------------------------------------------------------------
// State handlers
// ---------------------------------------------------------------------------

bool voiceDetectedStart() {
  if (!voiceReady) {
    return false;
  }

  if (!microphoneInferenceRecord()) {
    if (EMIT_VOICE_DEBUG && (millis() - lastVoiceDebugMs) >= VOICE_DEBUG_INTERVAL_MS) {
      Serial.print("{\"event\":\"voice_debug\",\"state\":\"");
      Serial.print(stateName(currentState));
      Serial.println("\",\"status\":\"buffer_overrun\"}");
      lastVoiceDebugMs = millis();
    }
    return false;
  }

  signal_t signal;
  signal.total_length = VOICE_MODEL_SLICE_SIZE;
  signal.get_data = &microphoneAudioSignalGetData;

  ei_impulse_result_t result = {0};
  EI_IMPULSE_ERROR status = run_classifier_continuous(&voice_impulse_handle, &signal, &result, debug_nn);
  if (status != EI_IMPULSE_OK) {
    if (EMIT_VOICE_DEBUG && (millis() - lastVoiceDebugMs) >= VOICE_DEBUG_INTERVAL_MS) {
      Serial.print("{\"event\":\"voice_debug\",\"state\":\"");
      Serial.print(stateName(currentState));
      Serial.print("\",\"status\":\"classifier_error\",\"code\":");
      Serial.print((int)status);
      Serial.println("}");
      lastVoiceDebugMs = millis();
    }
    return false;
  }

  if (EMIT_VOICE_DEBUG && (millis() - lastVoiceDebugMs) >= VOICE_DEBUG_INTERVAL_MS) {
    printVoiceDebug(result);
    lastVoiceDebugMs = millis();
  }

  const float startConfidence = findClassificationValue(result, VOICE_MODEL_LABEL_COUNT, "start");
  const unsigned long now = millis();
  const bool voiceArmed = (now - voiceArmStartMs) >= VOICE_ARM_DELAY_MS;

  if (startConfidence < VOICE_RELEASE_THRESHOLD) {
    voiceTriggerLatched = false;
    voiceStartStreak = 0;
    return false;
  }

  if (startConfidence < VOICE_START_THRESHOLD) {
    voiceStartStreak = 0;
    return false;
  }

  if (!voiceArmed) {
    voiceStartStreak = 0;
    return false;
  }

  voiceStartStreak++;
  if (voiceStartStreak < VOICE_REQUIRED_STREAK) {
    return false;
  }

  if (voiceTriggerLatched) {
    return false;
  }

  if ((now - lastVoiceTriggerMs) < VOICE_TRIGGER_COOLDOWN_MS) {
    return false;
  }

  voiceTriggerLatched = true;
  lastVoiceTriggerMs = now;
  return true;
}

bool greenDetected() {
  if (!colourReady) {
    return false;
  }

  int r = 0;
  int g = 0;
  int b = 0;
  int clearValue = 0;

  if (!readColourSample(r, g, b, clearValue)) {
    return false;
  }

  float features[COLOUR_MODEL_INPUT_FRAME_SIZE] = {
    (float)r,
    (float)g,
    (float)b,
    (float)clearValue
  };

  signal_t signal;
  int signalStatus = numpy::signal_from_buffer(features, COLOUR_MODEL_INPUT_FRAME_SIZE, &signal);
  if (signalStatus != 0) {
    if (EMIT_COLOUR_DEBUG && (millis() - lastColourDebugMs) >= COLOUR_DEBUG_INTERVAL_MS) {
      printColourError(r, g, b, clearValue, signalStatus);
      lastColourDebugMs = millis();
    }
    greenStreak = 0;
    return false;
  }

  ei_impulse_result_t result = {0};
  EI_IMPULSE_ERROR status = run_classifier(&colour_impulse_handle, &signal, &result, false);
  if (status != EI_IMPULSE_OK) {
    if (EMIT_COLOUR_DEBUG && (millis() - lastColourDebugMs) >= COLOUR_DEBUG_INTERVAL_MS) {
      printColourError(r, g, b, clearValue, (int)status);
      lastColourDebugMs = millis();
    }
    greenStreak = 0;
    return false;
  }

  float topConfidence = 0.0f;
  const char *topLabel = findTopClassification(result, COLOUR_MODEL_LABEL_COUNT, topConfidence);
  const float greenConfidence = findClassificationValue(result, COLOUR_MODEL_LABEL_COUNT, "green");
  const bool greenNow =
    strcmp(topLabel, "green") == 0 &&
    greenConfidence >= COLOUR_GREEN_THRESHOLD;

  if (greenNow) {
    greenStreak++;
  } else {
    greenStreak = 0;
  }

  if (EMIT_COLOUR_DEBUG && (millis() - lastColourDebugMs) >= COLOUR_DEBUG_INTERVAL_MS) {
    printColourDebug(r, g, b, clearValue, result, greenNow, greenConfidence, topLabel, topConfidence);
    lastColourDebugMs = millis();
  }

  return greenStreak >= COLOUR_REQUIRED_STREAK;
}

void sendMovementData() {
  if (!imuReady) {
    return;
  }

  readMovementSample();

  const unsigned long nowMs = millis();
  if ((nowMs - lastMovementOutputMs) < MOVEMENT_OUTPUT_INTERVAL_MS) {
    return;
  }

  lastMovementOutputMs = nowMs;

  const bool bufferReady = buildMovementInferenceBuffer();
  const char *movementClass = "collecting";
  float movementConfidence = 0.0f;
  bool classifierOk = false;

  if (bufferReady) {
    signal_t signal;
    int signalStatus = numpy::signal_from_buffer(
      movementInferenceBuffer,
      MOVEMENT_MODEL_INPUT_FRAME_SIZE,
      &signal
    );

    if (signalStatus == 0) {
      ei_impulse_result_t result = {0};
      EI_IMPULSE_ERROR status = run_classifier(&movement_impulse_handle, &signal, &result, false);

      if (status == EI_IMPULSE_OK) {
        movementClass = findTopClassification(result, MOVEMENT_MODEL_LABEL_COUNT, movementConfidence);
        classifierOk = true;
      }
    }
  }

  Serial.print("{\"event\":\"movement\",\"ax\":");
  Serial.print(latestAx, 3);
  Serial.print(",\"ay\":");
  Serial.print(latestAy, 3);
  Serial.print(",\"az\":");
  Serial.print(latestAz, 3);
  Serial.print(",\"gx\":");
  Serial.print(latestGx, 3);
  Serial.print(",\"gy\":");
  Serial.print(latestGy, 3);
  Serial.print(",\"gz\":");
  Serial.print(latestGz, 3);
  Serial.print(",\"movementClass\":\"");
  Serial.print(movementClass);
  Serial.print("\",\"movementConfidence\":");
  Serial.print(movementConfidence, 5);
  Serial.print(",\"movementBufferReady\":");
  printJsonBool(bufferReady);
  Serial.print(",\"movementClassifierOk\":");
  printJsonBool(classifierOk);

  if (
    classifierOk &&
    movementConfidence >= MOVEMENT_DIRECTION_THRESHOLD &&
    strcmp(movementClass, "idle") != 0
  ) {
    Serial.print(",\"direction\":\"");
    Serial.print(movementClass);
    Serial.print("\"");
  }

  Serial.println("}");
}

void printJsonEvent(const char* eventName) {
  Serial.print("{\"event\":\"");
  Serial.print(eventName);
  Serial.println("\"}");
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

static bool initVoiceModule() {
  run_classifier_init(&voice_impulse_handle);
  if (!microphoneInferenceStart(VOICE_MODEL_SLICE_SIZE)) {
    debugLog("Voice buffer allocation failed.");
    return false;
  }

  return true;
}

static bool initColourModule() {
  if (!APDS.begin()) {
    debugLog("APDS-9960 init failed.");
    return false;
  }

  return true;
}

static bool initImuModule() {
  if (!IMU.begin()) {
    debugLog("LSM9DS1 init failed.");
    return false;
  }

  return true;
}

static void stopVoiceModule() {
  if (!voiceReady) {
    return;
  }

  run_classifier_deinit(&voice_impulse_handle);
  microphoneInferenceEnd();
  voiceReady = false;
}

// ---------------------------------------------------------------------------
// Sensor helpers
// ---------------------------------------------------------------------------

static bool readColourSample(int &r, int &g, int &b, int &clearValue) {
  unsigned long startMs = millis();
  while (!APDS.colorAvailable()) {
    if ((millis() - startMs) > 50) {
      return false;
    }
    delay(2);
  }

  APDS.readColor(r, g, b, clearValue);
  return true;
}

static bool readMovementSample() {
  const unsigned long nowUs = micros();
  const unsigned long sampleIntervalUs = (unsigned long)(MOVEMENT_MODEL_SAMPLE_INTERVAL_MS * 1000.0f);

  if (lastMovementSampleUs != 0 && (nowUs - lastMovementSampleUs) < sampleIntervalUs) {
    return false;
  }

  if (!IMU.accelerationAvailable()) {
    return false;
  }

  IMU.readAcceleration(latestAx, latestAy, latestAz);

  if (IMU.gyroscopeAvailable()) {
    IMU.readGyroscope(latestGx, latestGy, latestGz);
  }

  const uint16_t offset = movementWriteSample * MOVEMENT_MODEL_AXES;
  movementRing[offset + 0] = latestAx * CONVERT_G_TO_MS2;
  movementRing[offset + 1] = latestAy * CONVERT_G_TO_MS2;
  movementRing[offset + 2] = latestAz * CONVERT_G_TO_MS2;

  movementWriteSample = (movementWriteSample + 1) % MOVEMENT_MODEL_RAW_SAMPLE_COUNT;
  if (movementSampleCount < MOVEMENT_MODEL_RAW_SAMPLE_COUNT) {
    movementSampleCount++;
  }

  lastMovementSampleUs = nowUs;
  return true;
}

static bool buildMovementInferenceBuffer() {
  if (movementSampleCount < MOVEMENT_MODEL_RAW_SAMPLE_COUNT) {
    return false;
  }

  for (uint16_t sample = 0; sample < MOVEMENT_MODEL_RAW_SAMPLE_COUNT; sample++) {
    const uint16_t sourceSample = (movementWriteSample + sample) % MOVEMENT_MODEL_RAW_SAMPLE_COUNT;
    const uint16_t sourceOffset = sourceSample * MOVEMENT_MODEL_AXES;
    const uint16_t targetOffset = sample * MOVEMENT_MODEL_AXES;

    movementInferenceBuffer[targetOffset + 0] = movementRing[sourceOffset + 0];
    movementInferenceBuffer[targetOffset + 1] = movementRing[sourceOffset + 1];
    movementInferenceBuffer[targetOffset + 2] = movementRing[sourceOffset + 2];
  }

  return true;
}

static void resetMovementBuffer() {
  movementWriteSample = 0;
  movementSampleCount = 0;
  lastMovementSampleUs = 0;
  lastMovementOutputMs = 0;

  for (uint16_t index = 0; index < MOVEMENT_MODEL_INPUT_FRAME_SIZE; index++) {
    movementRing[index] = 0.0f;
    movementInferenceBuffer[index] = 0.0f;
  }
}

// ---------------------------------------------------------------------------
// Edge Impulse audio helpers
// ---------------------------------------------------------------------------

static void pdmDataReadyInferenceCallback() {
  if (sampleBuffer == nullptr) {
    return;
  }

  int bytesAvailable = PDM.available();
  int bytesRead = PDM.read((char *)&sampleBuffer[0], bytesAvailable);

  if (recordReady) {
    for (int i = 0; i < (bytesRead >> 1); i++) {
      inference.buffers[inference.buf_select][inference.buf_count++] = sampleBuffer[i];

      if (inference.buf_count >= inference.n_samples) {
        inference.buf_select ^= 1;
        inference.buf_count = 0;
        inference.buf_ready = 1;
      }
    }
  }
}

static bool microphoneInferenceStart(uint32_t n_samples) {
  inference.buffers[0] = (signed short *)malloc(n_samples * sizeof(signed short));
  if (inference.buffers[0] == nullptr) {
    return false;
  }

  inference.buffers[1] = (signed short *)malloc(n_samples * sizeof(signed short));
  if (inference.buffers[1] == nullptr) {
    free(inference.buffers[0]);
    inference.buffers[0] = nullptr;
    return false;
  }

  sampleBuffer = (signed short *)malloc((n_samples >> 1) * sizeof(signed short));
  if (sampleBuffer == nullptr) {
    free(inference.buffers[0]);
    free(inference.buffers[1]);
    inference.buffers[0] = nullptr;
    inference.buffers[1] = nullptr;
    return false;
  }

  inference.buf_select = 0;
  inference.buf_count = 0;
  inference.n_samples = n_samples;
  inference.buf_ready = 0;

  PDM.onReceive(&pdmDataReadyInferenceCallback);
  PDM.setBufferSize((n_samples >> 1) * sizeof(int16_t));

  if (!PDM.begin(1, VOICE_MODEL_FREQUENCY)) {
    microphoneInferenceEnd();
    return false;
  }

  PDM.setGain(127);
  recordReady = true;
  return true;
}

static bool microphoneInferenceRecord() {
  bool ok = true;

  if (inference.buf_ready == 1) {
    ok = false;
  }

  while (inference.buf_ready == 0) {
    delay(1);
  }

  inference.buf_ready = 0;
  return ok;
}

static int microphoneAudioSignalGetData(size_t offset, size_t length, float *out_ptr) {
  numpy::int16_to_float(&inference.buffers[inference.buf_select ^ 1][offset], out_ptr, length);
  return 0;
}

static void microphoneInferenceEnd() {
  recordReady = false;
  PDM.end();

  if (inference.buffers[0] != nullptr) {
    free(inference.buffers[0]);
    inference.buffers[0] = nullptr;
  }

  if (inference.buffers[1] != nullptr) {
    free(inference.buffers[1]);
    inference.buffers[1] = nullptr;
  }

  if (sampleBuffer != nullptr) {
    free(sampleBuffer);
    sampleBuffer = nullptr;
  }

  inference.buf_ready = 0;
  inference.buf_count = 0;
}

// ---------------------------------------------------------------------------
// JSON/debug helpers
// ---------------------------------------------------------------------------

static void debugLog(const char* message) {
  if (!DEBUG_SERIAL) {
    return;
  }

  Serial.print("{\"event\":\"debug\",\"message\":\"");
  Serial.print(message);
  Serial.println("\"}");
}

static float findClassificationValue(const ei_impulse_result_t &result, size_t labelCount, const char *label) {
  for (size_t index = 0; index < labelCount; index++) {
    if (strcmp(result.classification[index].label, label) == 0) {
      return result.classification[index].value;
    }
  }

  return 0.0f;
}

static const char* findTopClassification(
  const ei_impulse_result_t &result,
  size_t labelCount,
  float &confidence
) {
  const char *topLabel = "";
  confidence = 0.0f;

  for (size_t index = 0; index < labelCount; index++) {
    if (index == 0 || result.classification[index].value > confidence) {
      topLabel = result.classification[index].label;
      confidence = result.classification[index].value;
    }
  }

  return topLabel;
}

static const char* stateName(SystemState state) {
  switch (state) {
    case WAITING_FOR_VOICE:
      return "WAITING_FOR_VOICE";
    case WAITING_FOR_COLOUR:
      return "WAITING_FOR_COLOUR";
    case TRACKING_MOVEMENT:
      return "TRACKING_MOVEMENT";
    default:
      return "UNKNOWN";
  }
}

static void printJsonBool(bool value) {
  Serial.print(value ? "true" : "false");
}

static void printSetupStatus() {
  Serial.print("{\"event\":\"setup_status\",\"state\":\"");
  Serial.print(stateName(currentState));
  Serial.print("\",\"voiceReady\":");
  printJsonBool(voiceReady);
  Serial.print(",\"colourReady\":");
  printJsonBool(colourReady);
  Serial.print(",\"imuReady\":");
  printJsonBool(imuReady);
  Serial.print(",\"models\":{\"voice\":\"970121\",\"colour\":\"970107\",\"movement\":\"928825\"}");
  Serial.println("}");
}

static void printVoiceDebug(const ei_impulse_result_t &result) {
  Serial.print("{\"event\":\"voice_debug\",\"state\":\"");
  Serial.print(stateName(currentState));
  Serial.print("\",\"threshold\":");
  Serial.print(VOICE_START_THRESHOLD, 3);
  Serial.print(",\"armed\":");
  printJsonBool((millis() - voiceArmStartMs) >= VOICE_ARM_DELAY_MS);
  Serial.print(",\"streak\":");
  Serial.print(voiceStartStreak);
  Serial.print(",\"requiredStreak\":");
  Serial.print(VOICE_REQUIRED_STREAK);
  Serial.print(",\"latched\":");
  printJsonBool(voiceTriggerLatched);
  Serial.print(",\"scores\":{");

  for (size_t index = 0; index < VOICE_MODEL_LABEL_COUNT; index++) {
    if (index > 0) {
      Serial.print(",");
    }

    Serial.print("\"");
    Serial.print(result.classification[index].label);
    Serial.print("\":");
    Serial.print(result.classification[index].value, 5);
  }

  Serial.println("}}");
}

static void printColourDebug(
  int r,
  int g,
  int b,
  int clearValue,
  const ei_impulse_result_t &result,
  bool greenNow,
  float greenConfidence,
  const char *topLabel,
  float topConfidence
) {
  Serial.print("{\"event\":\"colour_debug\",\"state\":\"");
  Serial.print(stateName(currentState));
  Serial.print("\",\"r\":");
  Serial.print(r);
  Serial.print(",\"g\":");
  Serial.print(g);
  Serial.print(",\"b\":");
  Serial.print(b);
  Serial.print(",\"clear\":");
  Serial.print(clearValue);
  Serial.print(",\"greenNow\":");
  printJsonBool(greenNow);
  Serial.print(",\"streak\":");
  Serial.print(greenStreak);
  Serial.print(",\"greenConfidence\":");
  Serial.print(greenConfidence, 5);
  Serial.print(",\"topLabel\":\"");
  Serial.print(topLabel);
  Serial.print("\",\"topConfidence\":");
  Serial.print(topConfidence, 5);
  Serial.print(",\"threshold\":");
  Serial.print(COLOUR_GREEN_THRESHOLD, 3);
  Serial.print(",\"scores\":{");

  for (size_t index = 0; index < COLOUR_MODEL_LABEL_COUNT; index++) {
    if (index > 0) {
      Serial.print(",");
    }

    Serial.print("\"");
    Serial.print(result.classification[index].label);
    Serial.print("\":");
    Serial.print(result.classification[index].value, 5);
  }

  Serial.println("}}");
}

static void printColourError(int r, int g, int b, int clearValue, int status) {
  Serial.print("{\"event\":\"colour_debug\",\"state\":\"");
  Serial.print(stateName(currentState));
  Serial.print("\",\"status\":\"classifier_error\",\"code\":");
  Serial.print(status);
  Serial.print(",\"r\":");
  Serial.print(r);
  Serial.print(",\"g\":");
  Serial.print(g);
  Serial.print(",\"b\":");
  Serial.print(b);
  Serial.print(",\"clear\":");
  Serial.print(clearValue);
  Serial.println("}");
}
