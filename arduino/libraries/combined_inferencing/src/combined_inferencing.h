/*
 * Combined Edge Impulse include for the Nano 33 BLE demo.
 *
 * Do not include the three generated *_inferencing.h headers together. They
 * define the same global SDK symbols. This local tree exposes three explicit
 * impulse handles from one shared SDK copy instead.
 */

#ifndef COMBINED_INFERENCING_H
#define COMBINED_INFERENCING_H

#include <Arduino.h>
#include <stdarg.h>

#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#ifdef round
#undef round
#endif
#ifdef DEFAULT
#undef DEFAULT
#endif
#ifdef A0
#undef A0
#endif
#ifdef A1
#undef A1
#endif
#ifdef A2
#undef A2
#endif

#include "edge-impulse-sdk/classifier/ei_run_classifier.h"
#include "edge-impulse-sdk/dsp/numpy.hpp"
#include "model-parameters/model_metadata.h"

static const uint32_t VOICE_MODEL_RAW_SAMPLE_COUNT = 16000;
static const uint32_t VOICE_MODEL_SLICES_PER_WINDOW = 4;
static const uint32_t VOICE_MODEL_SLICE_SIZE = VOICE_MODEL_RAW_SAMPLE_COUNT / VOICE_MODEL_SLICES_PER_WINDOW;
static const uint32_t VOICE_MODEL_FREQUENCY = 16000;
static const uint8_t VOICE_MODEL_LABEL_COUNT = 2;

static const uint32_t COLOUR_MODEL_INPUT_FRAME_SIZE = 4;
static const uint8_t COLOUR_MODEL_LABEL_COUNT = 4;

static const uint32_t MOVEMENT_MODEL_RAW_SAMPLE_COUNT = 88;
static const uint32_t MOVEMENT_MODEL_AXES = 3;
static const uint32_t MOVEMENT_MODEL_INPUT_FRAME_SIZE =
    MOVEMENT_MODEL_RAW_SAMPLE_COUNT * MOVEMENT_MODEL_AXES;
static const float MOVEMENT_MODEL_SAMPLE_INTERVAL_MS = 22.727272727272727f;
static const uint8_t MOVEMENT_MODEL_LABEL_COUNT = 5;

extern void ei_printf(const char *format, ...);

#endif
