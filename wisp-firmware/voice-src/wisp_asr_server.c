// wisp_asr_server: Wisp's on-device speech-to-text, a long-lived sidecar the
// daemon talks to over stdin/stdout. It loads one sherpa-onnx model once, then
// for each line it reads (a 16 kHz mono WAV path) it prints one line: the text.
// "READY" on stdout means the model is loaded.
//
// It runs any of the small models Wisp uses:
//   --type offline-transducer   Zipformer (encoder/decoder/joiner)
//   --type online-transducer    streaming Zipformer, fed the whole clip
//   --type moonshine            Moonshine (preprocessor/encoder/decoders)
//
// --hotwords <file> biases recognition toward the words in it (one phrase per
// line: the library's playlists, artists and songs), with modified beam search.
// --provider-config <file> passes ONNX Runtime settings (EnableCpuMemArena=0).
//
// Built against the sherpa-onnx C API (v1.13.3, commit 330609da) that the voice bundle ships.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "c-api.h"

struct opts {
  const char *type, *encoder, *decoder, *joiner, *tokens;
  const char *preprocessor, *uncached, *cached;
  const char *hotwords, *method, *provider_config;
  float hotwords_score;
  int threads;
};

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage: %s --type offline-transducer|online-transducer|moonshine --tokens F\n"
          "  [--encoder F --decoder F --joiner F] [--preprocessor F --uncached F --cached F]\n"
          "  [--threads N] [--method greedy_search|modified_beam_search]\n"
          "  [--hotwords F [--hotwords-score S]] [--provider-config F]\n",
          argv0);
}

static int parse(int argc, char **argv, struct opts *o) {
  memset(o, 0, sizeof(*o));
  o->threads = 2;
  o->method = "greedy_search";
  o->hotwords_score = 1.5f;
  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    const char *v = (i + 1 < argc) ? argv[i + 1] : NULL;
#define OPT(name, field) \
  if (!strcmp(a, name) && v) { o->field = v; i++; continue; }
    OPT("--type", type)
    OPT("--encoder", encoder)
    OPT("--decoder", decoder)
    OPT("--joiner", joiner)
    OPT("--tokens", tokens)
    OPT("--preprocessor", preprocessor)
    OPT("--uncached", uncached)
    OPT("--cached", cached)
    OPT("--hotwords", hotwords)
    OPT("--method", method)
    OPT("--provider-config", provider_config)
#undef OPT
    if (!strcmp(a, "--threads") && v) { o->threads = atoi(v); i++; continue; }
    if (!strcmp(a, "--hotwords-score") && v) { o->hotwords_score = (float)atof(v); i++; continue; }
    fprintf(stderr, "unknown option %s\n", a);
    return -1;
  }
  if (!o->type || !o->tokens) return -1;
  // hotwords only work with modified beam search
  if (o->hotwords) o->method = "modified_beam_search";
  return 0;
}

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

// the provider string: "cpu", or "cpu:<settings file>"
static char provider_buf[1024];
static const char *provider(const struct opts *o) {
  if (!o->provider_config) return "cpu";
  snprintf(provider_buf, sizeof(provider_buf), "cpu:%s", o->provider_config);
  return provider_buf;
}

int main(int argc, char **argv) {
  struct opts o;
  if (parse(argc, argv, &o) != 0) {
    usage(argv[0]);
    return 2;
  }
  setvbuf(stdout, NULL, _IOLBF, 0);

  int online = !strcmp(o.type, "online-transducer");
  const SherpaOnnxOfflineRecognizer *off = NULL;
  const SherpaOnnxOnlineRecognizer *on = NULL;
  double t0 = now_ms();

  if (online) {
    SherpaOnnxOnlineRecognizerConfig c;
    memset(&c, 0, sizeof(c));
    c.feat_config.sample_rate = 16000;
    c.feat_config.feature_dim = 80;
    c.model_config.transducer.encoder = o.encoder;
    c.model_config.transducer.decoder = o.decoder;
    c.model_config.transducer.joiner = o.joiner;
    c.model_config.tokens = o.tokens;
    c.model_config.num_threads = o.threads;
    c.model_config.provider = provider(&o);
    c.decoding_method = o.method;
    c.max_active_paths = 4;
    c.hotwords_file = o.hotwords;
    c.hotwords_score = o.hotwords_score;
    on = SherpaOnnxCreateOnlineRecognizer(&c);
  } else {
    SherpaOnnxOfflineRecognizerConfig c;
    memset(&c, 0, sizeof(c));
    c.feat_config.sample_rate = 16000;
    c.feat_config.feature_dim = 80;
    if (!strcmp(o.type, "moonshine")) {
      c.model_config.moonshine.preprocessor = o.preprocessor;
      c.model_config.moonshine.encoder = o.encoder;
      c.model_config.moonshine.uncached_decoder = o.uncached;
      c.model_config.moonshine.cached_decoder = o.cached;
    } else {
      c.model_config.transducer.encoder = o.encoder;
      c.model_config.transducer.decoder = o.decoder;
      c.model_config.transducer.joiner = o.joiner;
    }
    c.model_config.tokens = o.tokens;
    c.model_config.num_threads = o.threads;
    c.model_config.provider = provider(&o);
    c.decoding_method = o.method;
    c.max_active_paths = 4;
    c.hotwords_file = o.hotwords;
    c.hotwords_score = o.hotwords_score;
    off = SherpaOnnxCreateOfflineRecognizer(&c);
  }
  if (!off && !on) {
    fprintf(stderr, "wisp_asr_server: failed to load the %s model\n", o.type);
    return 3;
  }
  fprintf(stderr, "wisp_asr_server: %s model loaded in %.0f ms (threads=%d, method=%s)\n", o.type,
          now_ms() - t0, o.threads, o.method);
  printf("READY\n");

  char line[8192];
  while (fgets(line, sizeof(line), stdin) != NULL) {
    size_t n = strlen(line);
    while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = '\0';
    if (n == 0) {
      printf("\n");
      continue;
    }
    const SherpaOnnxWave *w = SherpaOnnxReadWave(line);
    if (w == NULL) {
      fprintf(stderr, "wisp_asr_server: can't read %s\n", line);
      printf("\n");
      continue;
    }
    double d0 = now_ms();
    const char *text = "";
    if (online) {
      const SherpaOnnxOnlineStream *s = SherpaOnnxCreateOnlineStream(on);
      SherpaOnnxOnlineStreamAcceptWaveform(s, w->sample_rate, w->samples, w->num_samples);
      // a little silence lets the model emit the last word
      float tail[8000] = {0};
      SherpaOnnxOnlineStreamAcceptWaveform(s, w->sample_rate, tail, 8000);
      SherpaOnnxOnlineStreamInputFinished(s);
      while (SherpaOnnxIsOnlineStreamReady(on, s)) SherpaOnnxDecodeOnlineStream(on, s);
      const SherpaOnnxOnlineRecognizerResult *r = SherpaOnnxGetOnlineStreamResult(on, s);
      printf("%s\n", r && r->text ? r->text : text);
      SherpaOnnxDestroyOnlineRecognizerResult(r);
      SherpaOnnxDestroyOnlineStream(s);
    } else {
      const SherpaOnnxOfflineStream *s = SherpaOnnxCreateOfflineStream(off);
      SherpaOnnxAcceptWaveformOffline(s, w->sample_rate, w->samples, w->num_samples);
      SherpaOnnxDecodeOfflineStream(off, s);
      const SherpaOnnxOfflineRecognizerResult *r = SherpaOnnxGetOfflineStreamResult(s);
      printf("%s\n", r && r->text ? r->text : text);
      SherpaOnnxDestroyOfflineRecognizerResult(r);
      SherpaOnnxDestroyOfflineStream(s);
    }
    fprintf(stderr, "wisp_asr_server: decoded %.1f s of audio in %.0f ms\n",
            (double)w->num_samples / w->sample_rate, now_ms() - d0);
    SherpaOnnxFreeWave(w);
  }
  return 0;
}
