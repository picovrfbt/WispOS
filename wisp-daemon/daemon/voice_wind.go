package daemon

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
	"os"
)

// Wind on the mic. Each spoken command arrives as a short clip; before it's
// transcribed, Wisp checks it for wind: a window down or a convertible roof
// fills a microphone with a loud, gusty rumble below the voice, where steady
// road and engine noise is quieter and even. When there's a lot of it the
// screen gets a small heads-up, and a command that wasn't understood says
// it was the wind rather than a plain "didn't catch that".
//
// The thresholds are a first guess: each clip's numbers go to the log
// ("voice: wind ...") so they can be tuned from real drives.

// ApiEventTypeVoiceWind tells the screen the last command was windy: {level: "some"|"strong"}
const ApiEventTypeVoiceWind ApiEventType = "voice/wind"

type windLevel int32

const (
	windNone windLevel = iota
	windSome
	windStrong
)

func (w windLevel) String() string {
	return [...]string{"none", "some", "strong"}[w]
}

type windReading struct {
	// share of the clip's energy below windCutHz
	lowShare float64
	// the rumble's loudness, dBFS
	lowDb float64
	// how much the rumble swings frame to frame (coefficient of variation): wind gusts, road noise doesn't
	gust float64
}

// below this is wind's rumble; speech has little energy down here
const windCutHz = 150

func (r windReading) level() windLevel {
	switch {
	// mostly rumble, or a very loud one even with the voice coming through
	case r.gust > 0.45 && ((r.lowShare > 0.7 && r.lowDb > -30) || (r.lowShare > 0.55 && r.lowDb > -12)):
		return windStrong
	case r.lowShare > 0.55 && r.lowDb > -38 && r.gust > 0.35:
		return windSome
	}
	return windNone
}

// measureWind reads a 16-bit PCM WAV (the command clip) and measures its wind
func measureWind(path string) (windReading, error) {
	samples, rate, err := readWavMono(path)
	if err != nil {
		return windReading{}, err
	}
	return windOf(samples, rate), nil
}

// windOf splits the clip at windCutHz with a one-pole low-pass and compares the halves
func windOf(x []float64, rate int) windReading {
	if len(x) == 0 || rate <= 0 {
		return windReading{lowDb: -120}
	}
	a := 1 - math.Exp(-2*math.Pi*windCutHz/float64(rate))
	frame := rate / 25 // 40 ms
	if frame < 1 {
		frame = 1
	}
	var low, all, fLow float64
	var frames []float64
	lp := 0.0
	for i, s := range x {
		lp += a * (s - lp)
		low += lp * lp
		all += s * s
		fLow += lp * lp
		if (i+1)%frame == 0 {
			frames = append(frames, fLow/float64(frame))
			fLow = 0
		}
	}
	r := windReading{lowDb: -120}
	if all > 0 {
		r.lowShare = low / all
	}
	if ms := low / float64(len(x)); ms > 0 {
		r.lowDb = 10 * math.Log10(ms)
	}
	if len(frames) > 2 {
		var mean, sq float64
		for _, f := range frames {
			mean += f
		}
		mean /= float64(len(frames))
		for _, f := range frames {
			sq += (f - mean) * (f - mean)
		}
		if mean > 0 {
			r.gust = math.Sqrt(sq/float64(len(frames))) / mean
		}
	}
	return r
}

// readWavMono reads 16-bit PCM WAV as -1..1, the channels mixed to one
func readWavMono(path string) ([]float64, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	var head [12]byte
	if _, err := io.ReadFull(f, head[:]); err != nil {
		return nil, 0, err
	}
	if string(head[0:4]) != "RIFF" || string(head[8:12]) != "WAVE" {
		return nil, 0, errors.New("not a wav")
	}
	channels, rate, bits := 0, 0, 0
	for {
		var ch [8]byte
		if _, err := io.ReadFull(f, ch[:]); err != nil {
			return nil, 0, errors.New("wav has no data")
		}
		size := int64(binary.LittleEndian.Uint32(ch[4:]))
		switch string(ch[0:4]) {
		case "fmt ":
			b := make([]byte, size)
			if _, err := io.ReadFull(f, b); err != nil || len(b) < 16 {
				return nil, 0, errors.New("bad wav format")
			}
			channels = int(binary.LittleEndian.Uint16(b[2:]))
			rate = int(binary.LittleEndian.Uint32(b[4:]))
			bits = int(binary.LittleEndian.Uint16(b[14:]))
		case "data":
			if bits != 16 || channels < 1 {
				return nil, 0, errors.New("wav isn't 16-bit pcm")
			}
			// a command is a few seconds: cap it so a bad header can't ask for gigabytes
			size = min(size, 4<<20)
			b := make([]byte, size)
			n, _ := io.ReadFull(f, b)
			b = b[:n-n%(2*channels)]
			out := make([]float64, len(b)/(2*channels))
			for i := range out {
				var sum float64
				for c := 0; c < channels; c++ {
					sum += float64(int16(binary.LittleEndian.Uint16(b[(i*channels+c)*2:])))
				}
				out[i] = sum / float64(channels) / 32768
			}
			return out, rate, nil
		default:
			if _, err := f.Seek(size+size%2, io.SeekCurrent); err != nil {
				return nil, 0, err
			}
		}
	}
}

// checkWind measures a command clip, remembers how windy it was for this
// command's messages, and tells the screen when it's enough to matter
func (v *voiceService) checkWind(clipPath string) {
	v.wind.Store(int32(windNone))
	if clipPath == "" {
		return
	}
	r, err := measureWind(clipPath)
	if err != nil {
		v.app.log.WithError(err).Debug("voice: wind check skipped")
		return
	}
	lv := r.level()
	v.app.log.Infof("voice: wind %s (low share %.2f, %.1f dBFS, gust %.2f)", lv, r.lowShare, r.lowDb, r.gust)
	v.wind.Store(int32(lv))
	if lv != windNone {
		v.app.server.Emit(&ApiEvent{Type: ApiEventTypeVoiceWind, Data: map[string]string{"level": lv.String()}})
	}
}

// windyMessage swaps a plain "didn't catch that" for the wind's fault when it was windy
func (v *voiceService) windyMessage(text string) string {
	if windLevel(v.wind.Load()) == windNone {
		return text
	}
	if text == "Sorry, I didn't catch that" || text == "Sorry, I didn’t catch that" {
		return "Too windy to hear you. Try closing a window"
	}
	return text
}
