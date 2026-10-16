# Wisp's speech server

`wisp_asr_server.c` is the on-device speech-to-text sidecar Wisp OS runs
(`voice.sherpa_bin: wisp_asr_server`). It loads one sherpa-onnx model and turns
WAV clips into text over stdin/stdout. Wisp OS ships it with Zipformer Small
(`sherpa-onnx-zipformer-small-en-2023-06-26`), fetched by
[`os/scripts/prepare.sh`](../os/scripts/prepare.sh) into `voice-models/`.

`c-api.h` is sherpa-onnx's C header at v1.13.3 (commit 330609da), the version of
`libsherpa-onnx-c-api.so` in the voice bundle; the two must match, since the
config structs differ between versions. `sherpa_version.c` prints the bundled
library's version, to check before updating either.

sherpa-onnx is Apache-2.0 (k2-fsa/sherpa-onnx).
