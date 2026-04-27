/*
 * Combined Edge Impulse model variables for the voice/colour/movement demo.
 * Derived from the three generated model_variables.h exports.
 */

#ifndef _EI_CLASSIFIER_MODEL_VARIABLES_H_
#define _EI_CLASSIFIER_MODEL_VARIABLES_H_

#include <stdint.h>
#include "model_metadata.h"
#include "tflite-model/tflite_learn_970121_6_compiled.h"
#include "tflite-model/tflite_learn_970107_5_compiled.h"
#include "tflite-model/tflite_learn_928825_36_compiled.h"
#include "edge-impulse-sdk/classifier/ei_model_types.h"
#include "edge-impulse-sdk/classifier/inferencing_engines/engines.h"
#include "edge-impulse-sdk/classifier/postprocessing/ei_postprocessing_common.h"

// ---------------------------------------------------------------------------
// Voice keyword model: labels start/unknown.
// Source: serhiisotskyi-project-1_inferencing/src/model-parameters/model_variables.h
// ---------------------------------------------------------------------------

const char* ei_classifier_inferencing_categories_970121_1[] = { "start", "unknown" };

EI_CLASSIFIER_DSP_AXES_INDEX_TYPE ei_dsp_config_970121_3_axes[] = { 0 };
const uint32_t ei_dsp_config_970121_3_axes_size = 1;
ei_dsp_config_mfe_t ei_dsp_config_970121_3 = {
    3, // uint32_t blockId
    4, // int implementationVersion
    1, // int length of axes
    NULL, // named axes
    0, // size of the named axes array
    0.02f, // float frame_length
    0.01f, // float frame_stride
    40, // int num_filters
    256, // int fft_length
    0, // int low_frequency
    0, // int high_frequency
    101, // int win_size
    -52 // int noise_floor_db
};

const uint8_t ei_dsp_blocks_970121_1_size = 1;
ei_model_dsp_t ei_dsp_blocks_970121_1[ei_dsp_blocks_970121_1_size] = {
    { // DSP block 3
        3,
        3960, // output size
        &extract_mfe_features, // DSP function pointer
        (void*)&ei_dsp_config_970121_3, // pointer to config struct
        ei_dsp_config_970121_3_axes, // array of offsets into the input stream, one for each axis
        ei_dsp_config_970121_3_axes_size, // number of axes
        1, // version
        nullptr, // factory function
        nullptr, // data normalization config
    }
};
const ei_config_tflite_eon_graph_t ei_config_graph_970121_6 = {
    .implementation_version = 1,
    .model_init = &tflite_learn_970121_6_init,
    .model_invoke = &tflite_learn_970121_6_invoke,
    .model_reset = &tflite_learn_970121_6_reset,
    .model_input = &tflite_learn_970121_6_input,
    .model_output = &tflite_learn_970121_6_output,
};

const uint8_t ei_output_tensors_indices_970121_6[1] = { 0 };
const uint8_t ei_output_tensors_size_970121_6 = 1;
ei_learning_block_config_tflite_graph_t ei_learning_block_config_970121_6 = {
    .implementation_version = 1,
    .block_id = 6,
    .output_tensors_indices = ei_output_tensors_indices_970121_6,
    .output_tensors_size = ei_output_tensors_size_970121_6,
    .quantized = 1,
    .compiled = 1,
    .graph_config = (void*)&ei_config_graph_970121_6,
    .dequantize_output = 0,
};

const uint8_t ei_learning_blocks_970121_1_size = 1;
const uint32_t ei_learning_block_970121_6_inputs[1] = { 3 };
const uint8_t ei_learning_block_970121_6_inputs_size = 1;
const ei_learning_block_t ei_learning_blocks_970121_1[ei_learning_blocks_970121_1_size] = {
    {
        6,
        &run_nn_inference,
        (void*)&ei_learning_block_config_970121_6,
        EI_CLASSIFIER_IMAGE_SCALING_NONE,
        ei_learning_block_970121_6_inputs,
        ei_learning_block_970121_6_inputs_size,
    },
};

ei_fill_result_classification_i8_config_t ei_fill_result_classification_i8_config_970121_6 = {
    .zero_point = -128,
    .scale = 0.00390625
};

const size_t ei_postprocessing_blocks_970121_1_size = 1;
const ei_postprocessing_block_t ei_postprocessing_blocks_970121_1[ei_postprocessing_blocks_970121_1_size] = {
    {
        .block_id = 6,
        .type = EI_CLASSIFIER_MODE_CLASSIFICATION,
        .init_fn = NULL,
        .deinit_fn = NULL,
        .postprocess_fn = &process_classification_i8,
        .display_fn = NULL,
        .config = (void*)&ei_fill_result_classification_i8_config_970121_6,
        .input_block_id = 6
    },
};

const uint8_t freeform_outputs_970121_1_size = 0;

uint32_t *freeform_outputs_970121_1 = nullptr;

const ei_impulse_t impulse_970121_1 = {
    .project_id = 970121,
    .project_owner = "serhiisotskyi",
    .project_name = "serhiisotskyi-project-1",
    .impulse_id = 1,
    .impulse_name = "Impulse #1",
    .deploy_version = 7,

    .nn_input_frame_size = 3960,
    .raw_sample_count = 16000,
    .raw_samples_per_frame = 1,
    .dsp_input_frame_size = 16000 * 1,
    .input_width = 0,
    .input_height = 0,
    .input_frames = 0,
    .interval_ms = 0.0625,
    .frequency = 16000,

    .dsp_blocks_size = ei_dsp_blocks_970121_1_size,
    .dsp_blocks = ei_dsp_blocks_970121_1,

    .learning_blocks_size = ei_learning_blocks_970121_1_size,
    .learning_blocks = ei_learning_blocks_970121_1,

    .postprocessing_blocks_size = ei_postprocessing_blocks_970121_1_size,
    .postprocessing_blocks = ei_postprocessing_blocks_970121_1,

    .output_tensors_size = 1,

    .inferencing_engine = EI_CLASSIFIER_TFLITE,

    .sensor = EI_CLASSIFIER_SENSOR_MICROPHONE,
    .fusion_string = "audio",
    .slice_size = (16000/4),
    .slices_per_model_window = 4,

    .has_anomaly = EI_ANOMALY_TYPE_UNKNOWN,
    .label_count = 2,
    .categories = ei_classifier_inferencing_categories_970121_1,
    .results_type = EI_CLASSIFIER_TYPE_CLASSIFICATION,
    .freeform_outputs_size = freeform_outputs_970121_1_size,
    .freeform_outputs = freeform_outputs_970121_1
};

ei_impulse_handle_t impulse_handle_970121_1 = ei_impulse_handle_t( &impulse_970121_1 );

// ---------------------------------------------------------------------------
// Colour APDS model: labels blue/green/other/red.
// Source: pepstee-project-1_inferencing/src/model-parameters/model_variables.h
// ---------------------------------------------------------------------------

const char* ei_classifier_inferencing_categories_970107_1[] = { "blue", "green", "other", "red" };

EI_CLASSIFIER_DSP_AXES_INDEX_TYPE ei_dsp_config_970107_6_axes[] = { 0, 1, 2, 3 };
const uint32_t ei_dsp_config_970107_6_axes_size = 4;
ei_dsp_config_raw_t ei_dsp_config_970107_6 = {
    6, // uint32_t blockId
    1, // int implementationVersion
    4, // int length of axes
    1.0f // float scale-axes
};

const float ei_dn_standard_scaler_mean_970107_6[4] = { 30.555615260612573, 20.18269747447609, 14.785061794734014, 54.80118216012896 };
const float ei_dn_standard_scaler_scale_970107_6[4] = { 0.043340015795808984, 0.06286753309750656, 0.10271438066214568, 0.029218656075082915 };
const float ei_dn_standard_scaler_var_970107_6[4] = { 532.3801686300523, 253.01552007451852, 94.78453773127005, 1171.33070252512 };
ei_data_normalization_standard_scaler_config_t ei_data_normalization_standard_scaler_config_970107_6 = {
    .mean_data = (float *)ei_dn_standard_scaler_mean_970107_6,
    .mean_data_len = 4,
    .scale_data = (float *)ei_dn_standard_scaler_scale_970107_6,
    .scale_data_len = 4,
    .var_data = (float *)ei_dn_standard_scaler_var_970107_6,
    .var_data_len = 4
};
ei_data_normalization_t ei_data_normalization_config_970107_6 = {
    (void *) &ei_data_normalization_standard_scaler_config_970107_6, // config
    DATA_NORMALIZATION_METHOD_STANDARD_SCALER, // method
    nullptr, // context
    nullptr, // init func
    nullptr, // deinit func
    &data_normalization_standard_scaler // exec func
};

const uint8_t ei_dsp_blocks_970107_1_size = 1;
ei_model_dsp_t ei_dsp_blocks_970107_1[ei_dsp_blocks_970107_1_size] = {
    { // DSP block 6
        6,
        4, // output size
        &extract_raw_features, // DSP function pointer
        (void*)&ei_dsp_config_970107_6, // pointer to config struct
        ei_dsp_config_970107_6_axes, // array of offsets into the input stream, one for each axis
        ei_dsp_config_970107_6_axes_size, // number of axes
        1, // version
        nullptr, // factory function
        &ei_data_normalization_config_970107_6, // data normalization config
    }
};
const ei_config_tflite_eon_graph_t ei_config_graph_970107_5 = {
    .implementation_version = 1,
    .model_init = &tflite_learn_970107_5_init,
    .model_invoke = &tflite_learn_970107_5_invoke,
    .model_reset = &tflite_learn_970107_5_reset,
    .model_input = &tflite_learn_970107_5_input,
    .model_output = &tflite_learn_970107_5_output,
};

const uint8_t ei_output_tensors_indices_970107_5[1] = { 0 };
const uint8_t ei_output_tensors_size_970107_5 = 1;
ei_learning_block_config_tflite_graph_t ei_learning_block_config_970107_5 = {
    .implementation_version = 1,
    .block_id = 5,
    .output_tensors_indices = ei_output_tensors_indices_970107_5,
    .output_tensors_size = ei_output_tensors_size_970107_5,
    .quantized = 1,
    .compiled = 1,
    .graph_config = (void*)&ei_config_graph_970107_5,
    .dequantize_output = 0,
};

const uint8_t ei_learning_blocks_970107_1_size = 1;
const uint32_t ei_learning_block_970107_5_inputs[1] = { 6 };
const uint8_t ei_learning_block_970107_5_inputs_size = 1;
const ei_learning_block_t ei_learning_blocks_970107_1[ei_learning_blocks_970107_1_size] = {
    {
        5,
        &run_nn_inference,
        (void*)&ei_learning_block_config_970107_5,
        EI_CLASSIFIER_IMAGE_SCALING_NONE,
        ei_learning_block_970107_5_inputs,
        ei_learning_block_970107_5_inputs_size,
    },
};

ei_fill_result_classification_i8_config_t ei_fill_result_classification_i8_config_970107_5 = {
    .zero_point = -128,
    .scale = 0.00390625
};

const size_t ei_postprocessing_blocks_970107_1_size = 1;
const ei_postprocessing_block_t ei_postprocessing_blocks_970107_1[ei_postprocessing_blocks_970107_1_size] = {
    {
        .block_id = 5,
        .type = EI_CLASSIFIER_MODE_CLASSIFICATION,
        .init_fn = NULL,
        .deinit_fn = NULL,
        .postprocess_fn = &process_classification_i8,
        .display_fn = NULL,
        .config = (void*)&ei_fill_result_classification_i8_config_970107_5,
        .input_block_id = 5
    },
};

const uint8_t freeform_outputs_970107_1_size = 0;

uint32_t *freeform_outputs_970107_1 = nullptr;

const ei_impulse_t impulse_970107_1 = {
    .project_id = 970107,
    .project_owner = "pepstee",
    .project_name = "pepstee-project-1",
    .impulse_id = 1,
    .impulse_name = "Impulse #1",
    .deploy_version = 1,

    .nn_input_frame_size = 4,
    .raw_sample_count = 1,
    .raw_samples_per_frame = 4,
    .dsp_input_frame_size = 1 * 4,
    .input_width = 0,
    .input_height = 0,
    .input_frames = 0,
    .interval_ms = 1,
    .frequency = 0,

    .dsp_blocks_size = ei_dsp_blocks_970107_1_size,
    .dsp_blocks = ei_dsp_blocks_970107_1,

    .learning_blocks_size = ei_learning_blocks_970107_1_size,
    .learning_blocks = ei_learning_blocks_970107_1,

    .postprocessing_blocks_size = ei_postprocessing_blocks_970107_1_size,
    .postprocessing_blocks = ei_postprocessing_blocks_970107_1,

    .output_tensors_size = 1,

    .inferencing_engine = EI_CLASSIFIER_TFLITE,

    .sensor = EI_CLASSIFIER_SENSOR_FUSION,
    .fusion_string = "ch1 + ch2 + ch3 + ch4",
    .slice_size = (1/4),
    .slices_per_model_window = 4,

    .has_anomaly = EI_ANOMALY_TYPE_UNKNOWN,
    .label_count = 4,
    .categories = ei_classifier_inferencing_categories_970107_1,
    .results_type = EI_CLASSIFIER_TYPE_CLASSIFICATION,
    .freeform_outputs_size = freeform_outputs_970107_1_size,
    .freeform_outputs = freeform_outputs_970107_1
};

ei_impulse_handle_t impulse_handle_970107_1 = ei_impulse_handle_t( &impulse_970107_1 );

// ---------------------------------------------------------------------------
// Movement IMU model: labels down/idle/left/right/up.
// Source: joelshore-project-1-cpp-mcu-v1-impulse-#8/model-parameters/model_variables.h
// ---------------------------------------------------------------------------

const char* ei_classifier_inferencing_categories_928825_8[] = { "down", "idle", "left", "right", "up" };

EI_CLASSIFIER_DSP_AXES_INDEX_TYPE ei_dsp_config_928825_33_axes[] = { 0, 1, 2 };
const uint32_t ei_dsp_config_928825_33_axes_size = 3;
ei_dsp_config_flatten_t ei_dsp_config_928825_33 = {
    33, // uint32_t blockId
    1, // int implementationVersion
    3, // int length of axes
    1.0f, // float scale-axes
    true, // boolean average
    true, // boolean minimum
    true, // boolean maximum
    true, // boolean rms
    true, // boolean stdev
    true, // boolean skewness
    true, // boolean kurtosis
    0 // int moving_avg_num_windows
};

EI_CLASSIFIER_DSP_AXES_INDEX_TYPE ei_dsp_config_928825_34_axes[] = { 0, 1, 2 };
const uint32_t ei_dsp_config_928825_34_axes_size = 3;
ei_dsp_config_spectral_analysis_t ei_dsp_config_928825_34 = {
    34, // uint32_t blockId
    4, // int implementationVersion
    3, // int length of axes
    1.0f, // float scale-axes
    1, // int input-decimation-ratio
    "none", // select filter-type
    3.0f, // float filter-cutoff
    6, // int filter-order
    "FFT", // select analysis-type
    16, // int fft-length
    3, // int spectral-peaks-count
    0.1f, // float spectral-peaks-threshold
    "0.1, 0.5, 1.0, 2.0, 5.0", // string spectral-power-edges
    true, // boolean do-log
    true, // boolean do-fft-overlap
    1, // int wavelet-level
    "db4", // select wavelet
    false // boolean extra-low-freq
};

const uint8_t ei_dsp_blocks_928825_8_size = 2;
ei_model_dsp_t ei_dsp_blocks_928825_8[ei_dsp_blocks_928825_8_size] = {
    { // DSP block 33
        33,
        21, // output size
        &extract_flatten_features, // DSP function pointer
        (void*)&ei_dsp_config_928825_33, // pointer to config struct
        ei_dsp_config_928825_33_axes, // array of offsets into the input stream, one for each axis
        ei_dsp_config_928825_33_axes_size, // number of axes
        1, // version
        flatten_class::create, // factory function
        nullptr, // data normalization config
    },
    { // DSP block 34
        34,
        39, // output size
        &extract_spectral_analysis_features, // DSP function pointer
        (void*)&ei_dsp_config_928825_34, // pointer to config struct
        ei_dsp_config_928825_34_axes, // array of offsets into the input stream, one for each axis
        ei_dsp_config_928825_34_axes_size, // number of axes
        1, // version
        nullptr, // factory function
        nullptr, // data normalization config
    }
};
const ei_config_tflite_eon_graph_t ei_config_graph_928825_36 = {
    .implementation_version = 1,
    .model_init = &tflite_learn_928825_36_init,
    .model_invoke = &tflite_learn_928825_36_invoke,
    .model_reset = &tflite_learn_928825_36_reset,
    .model_input = &tflite_learn_928825_36_input,
    .model_output = &tflite_learn_928825_36_output,
};

const uint8_t ei_output_tensors_indices_928825_36[1] = { 0 };
const uint8_t ei_output_tensors_size_928825_36 = 1;
ei_learning_block_config_tflite_graph_t ei_learning_block_config_928825_36 = {
    .implementation_version = 1,
    .block_id = 36,
    .output_tensors_indices = ei_output_tensors_indices_928825_36,
    .output_tensors_size = ei_output_tensors_size_928825_36,
    .quantized = 1,
    .compiled = 1,
    .graph_config = (void*)&ei_config_graph_928825_36,
    .dequantize_output = 0,
};

const uint8_t ei_learning_blocks_928825_8_size = 1;
const uint32_t ei_learning_block_928825_36_inputs[2] = { 33,34 };
const uint8_t ei_learning_block_928825_36_inputs_size = 2;
const ei_learning_block_t ei_learning_blocks_928825_8[ei_learning_blocks_928825_8_size] = {
    {
        36,
        &run_nn_inference,
        (void*)&ei_learning_block_config_928825_36,
        EI_CLASSIFIER_IMAGE_SCALING_NONE,
        ei_learning_block_928825_36_inputs,
        ei_learning_block_928825_36_inputs_size,
    },
};

ei_fill_result_classification_i8_config_t ei_fill_result_classification_i8_config_928825_36 = {
    .zero_point = -128,
    .scale = 0.00390625
};

const size_t ei_postprocessing_blocks_928825_8_size = 1;
const ei_postprocessing_block_t ei_postprocessing_blocks_928825_8[ei_postprocessing_blocks_928825_8_size] = {
    {
        .block_id = 36,
        .type = EI_CLASSIFIER_MODE_CLASSIFICATION,
        .init_fn = NULL,
        .deinit_fn = NULL,
        .postprocess_fn = &process_classification_i8,
        .display_fn = NULL,
        .config = (void*)&ei_fill_result_classification_i8_config_928825_36,
        .input_block_id = 36
    },
};

const uint8_t freeform_outputs_928825_8_size = 0;

uint32_t *freeform_outputs_928825_8 = nullptr;

const ei_impulse_t impulse_928825_8 = {
    .project_id = 928825,
    .project_owner = "joelshore",
    .project_name = "joelshore-project-1",
    .impulse_id = 8,
    .impulse_name = "Impulse #8",
    .deploy_version = 1,

    .nn_input_frame_size = 60,
    .raw_sample_count = 88,
    .raw_samples_per_frame = 3,
    .dsp_input_frame_size = 88 * 3,
    .input_width = 0,
    .input_height = 0,
    .input_frames = 0,
    .interval_ms = 22.727272727272727,
    .frequency = 44,

    .dsp_blocks_size = ei_dsp_blocks_928825_8_size,
    .dsp_blocks = ei_dsp_blocks_928825_8,

    .learning_blocks_size = ei_learning_blocks_928825_8_size,
    .learning_blocks = ei_learning_blocks_928825_8,

    .postprocessing_blocks_size = ei_postprocessing_blocks_928825_8_size,
    .postprocessing_blocks = ei_postprocessing_blocks_928825_8,

    .output_tensors_size = 1,

    .inferencing_engine = EI_CLASSIFIER_TFLITE,

    .sensor = EI_CLASSIFIER_SENSOR_ACCELEROMETER,
    .fusion_string = "accX + accY + accZ",
    .slice_size = (88/4),
    .slices_per_model_window = 4,

    .has_anomaly = EI_ANOMALY_TYPE_UNKNOWN,
    .label_count = 5,
    .categories = ei_classifier_inferencing_categories_928825_8,
    .results_type = EI_CLASSIFIER_TYPE_CLASSIFICATION,
    .freeform_outputs_size = freeform_outputs_928825_8_size,
    .freeform_outputs = freeform_outputs_928825_8
};

ei_impulse_handle_t impulse_handle_928825_8 = ei_impulse_handle_t( &impulse_928825_8 );

ei_impulse_handle_t& voice_impulse_handle = impulse_handle_970121_1;
ei_impulse_handle_t& colour_impulse_handle = impulse_handle_970107_1;
ei_impulse_handle_t& movement_impulse_handle = impulse_handle_928825_8;

ei_impulse_handle_t& ei_default_impulse = voice_impulse_handle;
constexpr auto& ei_classifier_inferencing_categories = ei_classifier_inferencing_categories_970121_1;
const auto ei_dsp_blocks_size = ei_dsp_blocks_970121_1_size;
ei_model_dsp_t *ei_dsp_blocks = ei_dsp_blocks_970121_1;

#endif // _EI_CLASSIFIER_MODEL_VARIABLES_H_
