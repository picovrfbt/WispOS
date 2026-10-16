# Custom wake words

`okay_wisp.tflite` is the default: "Okay Wisp", custom-trained, reliable at a
0.3 threshold, where it also picks up "Hey Wisp". Builds use it unless told
otherwise.

Drop other openWakeWord `.tflite` models here and they're bundled into the
image too. Pick the one the Car Thing listens for at build time:

```
WAKE_MODEL=hey_mira.tflite WAKE_THRESHOLD=0.4 WAKE_THRESHOLD_PLAYING=0.6 just run
```

`WAKE_THRESHOLD` (default 0.3) is the sensitivity; `WAKE_THRESHOLD_PLAYING`
(default 0.45) is the stricter one used while music plays, where lyrics cause
false wakes. On a flashed device you can instead
copy a model into `/usr/share/mira/voice/models/` and set `voice.wake_model`
in `/etc/go-librespot/config.yml`. If the named file is missing the daemon logs
a warning and falls back to Hey Mira.

Models: openWakeWord's pre-trained ones (alexa, hey_jarvis, hey_mycroft, …) or
train your own phrase with its training notebook, which uses synthetic speech,
so no recordings are needed. Two or three distinct syllables work best, and
tune `voice.wake_threshold` / `wake_threshold_playing` after switching, since a
new model usually wants a different sensitivity.
