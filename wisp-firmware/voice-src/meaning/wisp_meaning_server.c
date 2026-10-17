/*
 * wisp_meaning_server: turns a sentence into its meaning (a 384-number
 * vector) with all-MiniLM-L6-v2, for the Car Thing's meaning-matcher
 * (wisp-daemon/daemon/voice_meaning.go). The daemon starts it only when its
 * own rules miss and stops it after a quiet minute, so it costs no memory the
 * rest of the time.
 *
 * Uses the ONNX Runtime the speech recogniser already ships
 * (libonnxruntime.so 1.24.4; onnxruntime_c_api.h here is that version's).
 *
 *   wisp_meaning_server <model.onnx>
 *
 * Prints READY once loaded, then reads one line per sentence: its token ids
 * (the daemon does the tokenising), space separated. Answers each with the
 * mean-pooled, normalised vector, 384 numbers on one line, or "ERR <why>".
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "onnxruntime_c_api.h"

#define MAX_TOKENS 64

static const OrtApi *ort;

static int check(OrtStatus *s, const char *what) {
    if (!s) return 0;
    fprintf(stderr, "wisp_meaning_server: %s: %s\n", what, ort->GetErrorMessage(s));
    ort->ReleaseStatus(s);
    return 1;
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <model.onnx>\n", argv[0]);
        return 2;
    }
    ort = OrtGetApiBase()->GetApi(ORT_API_VERSION);
    if (!ort) {
        fprintf(stderr, "wisp_meaning_server: ONNX Runtime doesn't offer API %d\n", ORT_API_VERSION);
        return 1;
    }

    OrtEnv *env;
    OrtSessionOptions *opts;
    OrtSession *session;
    if (check(ort->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "wisp_meaning", &env), "env")) return 1;
    if (check(ort->CreateSessionOptions(&opts), "options")) return 1;
    // two of the four cores: the screen keeps the rest
    check(ort->SetIntraOpNumThreads(opts, 2), "SetIntraOpNumThreads");
    check(ort->SetInterOpNumThreads(opts, 1), "SetInterOpNumThreads");
    // keep no memory arena between sentences: the daemon's memory budget is tight
    check(ort->DisableCpuMemArena(opts), "DisableCpuMemArena");
    check(ort->SetSessionGraphOptimizationLevel(opts, ORT_ENABLE_ALL), "SetSessionGraphOptimizationLevel");
    if (check(ort->CreateSession(env, argv[1], opts, &session), "load")) return 1;

    // the model takes input_ids, attention_mask and (usually) token_type_ids
    OrtAllocator *alloc;
    check(ort->GetAllocatorWithDefaultOptions(&alloc), "GetAllocatorWithDefaultOptions");
    size_t n_in = 0;
    check(ort->SessionGetInputCount(session, &n_in), "SessionGetInputCount");
    int has_types = 0;
    for (size_t i = 0; i < n_in; i++) {
        char *name;
        check(ort->SessionGetInputName(session, i, alloc, &name), "SessionGetInputName");
        if (strcmp(name, "token_type_ids") == 0) has_types = 1;
        check(ort->AllocatorFree(alloc, name), "AllocatorFree");
    }
    char *out_name;
    check(ort->SessionGetOutputName(session, 0, alloc, &out_name), "SessionGetOutputName");

    OrtMemoryInfo *mem;
    check(ort->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem), "CreateCpuMemoryInfo");

    printf("READY\n");
    fflush(stdout);

    char line[4096];
    int64_t ids[MAX_TOKENS], mask[MAX_TOKENS], types[MAX_TOKENS];
    while (fgets(line, sizeof line, stdin)) {
        size_t n = 0;
        for (char *p = strtok(line, " \t\r\n"); p && n < MAX_TOKENS; p = strtok(NULL, " \t\r\n")) {
            ids[n] = strtoll(p, NULL, 10);
            mask[n] = 1;
            types[n] = 0;
            n++;
        }
        if (n == 0) {
            printf("ERR empty\n");
            fflush(stdout);
            continue;
        }
        int64_t shape[2] = {1, (int64_t)n};
        OrtValue *in[3] = {NULL, NULL, NULL};
        const char *in_names[3] = {"input_ids", "attention_mask", "token_type_ids"};
        check(ort->CreateTensorWithDataAsOrtValue(mem, ids, n * sizeof(int64_t), shape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &in[0]), "CreateTensorWithDataAsOrtValue");
        check(ort->CreateTensorWithDataAsOrtValue(mem, mask, n * sizeof(int64_t), shape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &in[1]), "CreateTensorWithDataAsOrtValue");
        check(ort->CreateTensorWithDataAsOrtValue(mem, types, n * sizeof(int64_t), shape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &in[2]), "CreateTensorWithDataAsOrtValue");

        OrtValue *out = NULL;
        const char *out_names[1] = {out_name};
        if (check(ort->Run(session, NULL, in_names, (const OrtValue *const *)in, has_types ? 3 : 2, out_names, 1, &out), "run")) {
            printf("ERR run\n");
        } else {
            // [1, n, dim]: average over the tokens, then to unit length
            OrtTensorTypeAndShapeInfo *info;
            check(ort->GetTensorTypeAndShape(out, &info), "GetTensorTypeAndShape");
            int64_t dims[3] = {0, 0, 0};
            size_t nd = 0;
            check(ort->GetDimensionsCount(info, &nd), "GetDimensionsCount");
            check(ort->GetDimensions(info, dims, nd < 3 ? nd : 3), "GetDimensions");
            ort->ReleaseTensorTypeAndShapeInfo(info);
            float *h;
            check(ort->GetTensorMutableData(out, (void **)&h), "GetTensorMutableData");
            int64_t seq = dims[1], dim = dims[2];
            float v[1024];
            if (dim > 1024) dim = 1024;
            double norm = 0;
            for (int64_t d = 0; d < dim; d++) {
                double s = 0;
                for (int64_t t = 0; t < seq; t++) s += h[t * dims[2] + d];
                v[d] = (float)(s / seq);
                norm += (double)v[d] * v[d];
            }
            norm = sqrt(norm);
            for (int64_t d = 0; d < dim; d++) printf(d ? " %.5f" : "%.5f", norm > 0 ? v[d] / norm : 0.0);
            printf("\n");
            ort->ReleaseValue(out);
        }
        for (int i = 0; i < 3; i++) ort->ReleaseValue(in[i]);
        fflush(stdout);
    }
    return 0;
}
