"""
Drive Mode, prototype v7: a stem mixer.

Instead of writing the music note by note, this plays a finished, produced
track split into stems (drums, bass, other, vocals: Demucs's four, or Suno's
own) and mixes them from the drive, the way MBUX Sound Drive does:

  stopped       only the track's pads and melody, as a distant haze: almost
                muted, dark, mostly reverb
  moving        it clears with speed; the bass comes in, then the drums
  accelerating  everything, plus a wah on the melody that follows the pedal
  hard braking  a bass hit (a deep sub drop) and the drums pull back
  steering      the music swings to the outside of the turn

The drive rules are the same as sampled.py's; only the music source changed.

    python stem_drive.py <stems folder> [out.wav] [--start SECONDS]
"""

import os
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, resample_poly

import drive_music as dm
from drive_music import SR, CTRL, controls, follow, hp, lp, reverb_ir, smoothstep
from sampled import sub_drop, wah

STEMS = ("drums", "bass", "other", "vocals")


def load_stem(path):
    rate, x = wavfile.read(path)
    if x.dtype.kind == "i":
        x = x / float(np.iinfo(x.dtype).max)
    x = x.astype(np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if rate != SR:
        x = resample_poly(x, SR, rate, axis=0)
    return x


def find_start(drums, seconds):
    """where to start in the song: just before the drums are first properly in,
    so the drive's pull-away meets the track's full section"""
    win = SR * 2
    cs = np.concatenate([[0.0], np.cumsum(drums[:, 0] ** 2)])
    rms = np.sqrt(np.maximum((cs[win:] - cs[:-win]) / win, 0))[::SR // 4]
    full = np.nonzero(rms > 0.5 * rms.max())[0]
    t = full[0] / 4 - 12 if len(full) else 0
    # a drive longer than the song loops it, so any start point works
    return float(max(t, 0))


def curve(x, n):
    """a control-rate curve stretched to audio rate"""
    return np.interp(np.arange(n) / SR, np.arange(len(x)) / CTRL, x)


def render(folder, seconds=78.0, start=None):
    stems = {k: load_stem(os.path.join(folder, k + ".wav")) for k in STEMS
             if os.path.exists(os.path.join(folder, k + ".wav"))}
    n = int(seconds * SR)
    if start is None:
        start = find_start(stems["drums"], seconds) if "drums" in stems else 0.0
    i0 = int(start * SR)
    for k, x in stems.items():
        # a drive longer than the song goes round again from the start point
        stems[k] = x[i0 + np.arange(n) % max(len(x) - i0, 1)]
    zero = np.zeros((n, 2))
    drums, bass = stems.get("drums", zero), stems.get("bass", zero)
    other, vocals = stems.get("other", zero), stems.get("vocals", zero)

    c = controls(seconds)
    _, speed, accel, steer = dm.simulated_drive(seconds)
    capped = np.minimum(speed, 65)
    pedal = follow(np.clip(accel / 5.0, 0, 1) * 0.85 + np.clip(capped / 65, 0, 1) * 0.15, 0.04, 0.2)
    energy, brake = c["energy"], c["brake"]

    # ---- the layers, by the drive (all moving over a second or so, never snapping)
    g_bass = follow(np.clip(0.06 + 0.94 * smoothstep(capped, 3, 30) + 0.3 * energy, 0, 1.2), 0.8, 1.6)
    g_drums = follow(np.clip(0.8 * smoothstep(capped, 10, 45) + 0.6 * energy - 0.7 * brake, 0, 1.15), 0.5, 1.4)
    g_vocals = follow(0.4 + 0.6 * smoothstep(capped, 5, 40), 1.0, 2.0)
    g_surge = follow(np.clip(energy * 1.4, 0, 1), 0.2, 1.5)

    melodic = other + vocals * curve(g_vocals, n)[:, None]
    l = melodic[:, 0] + bass[:, 0] * curve(g_bass, n) + drums[:, 0] * curve(g_drums, n)
    r = melodic[:, 1] + bass[:, 1] * curve(g_bass, n) + drums[:, 1] * curve(g_drums, n)

    # ---- the surge: the melody again through a wah that follows the pedal
    p_ctrl = pedal
    wl, wr = wah(melodic[:, 0], melodic[:, 1], lambda tt: p_ctrl[min(int(tt * CTRL), len(p_ctrl) - 1)], dry=0.0)
    gs = curve(g_surge, n) * 0.35
    l, r = l + wl * gs, r + wr * gs

    # ---- the haze: what's heard stopped, the track far away in a big hall
    sy = dm.Synth(7)
    irl, irr = reverb_ir(sy, 5.0)
    send_l, send_r = melodic[:, 0] + 0.3 * bass[:, 0], melodic[:, 1] + 0.3 * bass[:, 1]
    wet_l = hp(fftconvolve(send_l, irl)[:n], 180, 1)
    wet_r = hp(fftconvolve(send_r, irr)[:n], 180, 1)
    haze_l = lp(lp(0.25 * send_l + 1.3 * wet_l, 700), 700)
    haze_r = lp(lp(0.25 * send_r + 1.3 * wet_r, 700), 700)
    # a little of the hall stays on the clear mix too
    l, r = l + 0.15 * wet_l, r + 0.15 * wet_r

    # ---- the door: clarity follows speed, the last of it only pushing or at speed
    clear = np.clip(0.03 + 0.92 * smoothstep(capped, 0, 55) + 0.35 * energy - 0.25 * brake, 0, 1)
    w = curve(follow(clear, 1.3, 1.8), n) ** 1.3
    g_shut = 10 ** (-11 / 20)
    mid = w * (l + r) / 2 + (1 - w) * (haze_l + haze_r) / 2 * g_shut
    side = w * (l - r) / 2 + (1 - w) * (haze_l - haze_r) / 2 * g_shut * 0.35
    l, r = mid + side, mid - side

    # ---- the brake hit: a deep sub drop on each hard brake
    # as DriveControls.kt: past 5 mph/s, and one hit per stop (8 s apart at least)
    hard = (accel < -5.0).astype(float)
    last = -1e9
    for k in np.nonzero(np.diff(hard) > 0)[0]:
        if (k - last) / CTRL < 8.0:
            continue
        last = k
        i = int((k + 1) / CTRL * SR)
        hit = sub_drop()[: n - i] * 0.9
        l[i:i + len(hit)] += hit
        r[i:i + len(hit)] += hit

    # ---- the turn: the music swings to the outside (turning right moves it left)
    st = curve(c["steer"], n)
    l = l * (1 - 0.75 * np.clip(-st, 0, 1))
    r = r * (1 - 0.75 * np.clip(st, 0, 1))

    mix = np.stack([l, r], axis=1)
    mix /= np.percentile(np.abs(mix), 99.8) + 1e-9
    mix = np.tanh(mix * 0.9) / np.tanh(1.4) * 0.89
    f = int(0.05 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-int(2.5 * SR):] *= np.linspace(1, 0, int(2.5 * SR))[:, None]
    print(f"started the song at {start:.1f} s")
    return mix


if __name__ == "__main__":
    args = sys.argv[1:]
    start = None
    if "--start" in args:
        k = args.index("--start")
        start = float(args[k + 1])
        del args[k:k + 2]
    folder = args[0]
    out = args[1] if len(args) > 1 else os.path.join("samples", "drive-mode-stems.wav")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    dm.write_wav(out, render(folder, start=start))
    print("wrote", out)
