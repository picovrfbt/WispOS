"""
Drive Mode, prototype v5: the generator playing real recorded instruments.

The composer and the drive rules are drive_music.py's; the instruments are
CC0 recordings (VSCO 2 Community Edition and VCSL, by Versilian Studios), one
note at a time, pitched to the note wanted from the nearest recorded one.
Synthesised still: the choir (there's no CC0 one), the shimmer, and the kick,
sub bass and brake hit, for punch.

New with the drive:
  hard braking  a bass hit: the orchestral bass drum and a deep sub drop
                (and timpani in Cinematic)
  steering      the music swings to the outside of the turn: turn right and
                it moves to the left speaker, and the other way
  accelerator   a wah on the surge layer that follows the pedal directly,
                like a guitar wah pedal (never an automatic sweep)
  the door      muffled when stopped, snapping wide open as you push

    WISP_SAMPLES=<folder with VSCO-2-CE/ and VCSL/> python sampled.py [ethereal|cinematic]
"""

import os
import re
import sys
from functools import lru_cache

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt, sosfilt_zi

import drive_music as dm
from drive_music import SR, CTRL, Bus, at, controls, env, follow, hp, hz, lp, ping_pong, reverb_ir, voice_lead

ROOT = os.environ.get("WISP_SAMPLES", "instrument-samples")
NOTE = re.compile(r"(?<![A-Za-z])([A-G])(#?)(-?\d)(?![\d])")
PCS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_of(name):
    m = NOTE.search(name.replace("%23", "#"))
    if not m:
        return None
    return 12 * (int(m.group(3)) + 1) + PCS[m.group(1)] + (1 if m.group(2) else 0)


def vel_of(name):
    m = re.search(r"_v(\d)", name)
    if m:
        return int(m.group(1))
    for k, v in (("_pp", 1), ("_p_", 2), ("_mf", 3), ("_f_", 4), ("_ff", 5)):
        if k in name:
            return v
    return 2


@lru_cache(maxsize=None)
def load(path):
    rate, data = wavfile.read(path)
    if data.dtype == np.int16:
        x = data.astype(np.float32) / 32768
    elif data.dtype == np.int32:
        x = data.astype(np.float32) / 2 ** 31
    elif data.dtype == np.uint8:
        x = (data.astype(np.float32) - 128) / 128
    else:
        x = data.astype(np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    x = x[:, :2]
    if rate != SR:
        idx = np.arange(0, len(x) - 1, rate / SR)
        x = np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)
    # start on the sound, not on silence
    lead = np.argmax(np.abs(x).max(1) > 0.003)
    return x[lead:]


class Instrument:
    """every recording in a folder (and below), by note and loudness"""

    # Versilian names middle C "C3", an octave under the usual; the harp is the exception
    def __init__(self, *folders, match=None, rng=None, octave_fix=12):
        self.zones = {}  # midi -> [(vel, path)]
        self.unpitched = []
        self.rng = rng or np.random.default_rng(3)
        for folder in folders:
            base = os.path.join(ROOT, folder)
            for dirpath, _, files in os.walk(base):
                for f in files:
                    if not f.lower().endswith(".wav") or (match and not re.search(match, f)):
                        continue
                    p = os.path.join(dirpath, f)
                    n = note_of(f)
                    if n is not None:
                        n += octave_fix
                    if n is None:
                        self.unpitched.append(p)
                    else:
                        self.zones.setdefault(n, []).append((vel_of(f), p))
        self.keys = np.array(sorted(self.zones))
        # recordings come at their natural (quiet) level: bring each instrument to a
        # working level by its loudest few files, keeping its own soft and loud
        paths = [p for zs in self.zones.values() for _, p in zs] + self.unpitched
        peaks = [float(np.abs(load(p)).max()) for p in paths[:: max(1, len(paths) // 8)][:8]] if paths else [1.0]
        self.norm = 0.6 / max(max(peaks), 1e-4)

    def __bool__(self):
        return bool(self.zones) or bool(self.unpitched)

    def note(self, midi, vel=0.6, hold=None, release=0.3, max_len=6.0):
        """a stereo (n, 2) recording of midi at loudness vel (0..1), held for `hold` seconds"""
        if not len(self.keys):
            return None
        src = int(self.keys[np.argmin(np.abs(self.keys - midi))])
        layers = self.zones[src]
        vels = sorted({v for v, _ in layers})
        want = vels[min(int(vel * len(vels)), len(vels) - 1)]
        path = self.rng.choice([p for v, p in layers if v == want])
        x = load(path)
        ratio = 2 ** ((midi - src) / 12)
        n_out = min(int(len(x) / ratio), int(max_len * SR))
        if ratio != 1:
            idx = np.arange(n_out) * ratio
            x = np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)
        else:
            x = x[:n_out]
        x = x * self.norm
        if hold is not None:
            h, r = int(hold * SR), int(release * SR)
            if h < len(x):
                fade = np.ones(len(x))
                k = min(r, len(x) - h)
                fade[h:h + k] = np.linspace(1, 0, k)
                fade[h + k:] = 0
                x = x[: h + k] * fade[: h + k, None]
        return x

    def hit(self, name_re=None, vel=0.7):
        """an unpitched sound, by name"""
        pool = self.unpitched + [p for zs in self.zones.values() for _, p in zs]
        if name_re:
            pool = [p for p in pool if re.search(name_re, os.path.basename(p))] or pool
        return load(self.rng.choice(pool)) * self.norm if pool else None


class StereoBus(Bus):
    def add2(self, x, start, gain=1.0, pan=0.0, width=1.0):
        if x is None or gain <= 0:
            return
        i = int(start * SR)
        if i >= len(self.l) or i < 0:
            return
        x = x[: len(self.l) - i] * gain
        mid, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2 * width
        a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        self.l[i:i + len(x)] += (mid + side) * np.cos(a) * 1.41
        self.r[i:i + len(x)] += (mid - side) * np.sin(a) * 1.41


def wah(l, r, pedal_at, block=256, q=5.0, dry=0.25):
    """a wah pedal: a resonant band moving with the accelerator, 450 Hz shut .. 2.6 kHz open"""
    ol, orr = np.zeros_like(l), np.zeros_like(r)
    zl = zr = None
    for i in range(0, len(l), block):
        p = float(np.clip(pedal_at(i / SR), 0, 1))
        fc = 450 * (2600 / 450) ** p
        bw = fc / q
        sos = butter(1, [fc - bw / 2, fc + bw / 2], "bandpass", fs=SR, output="sos")
        if zl is None:
            zl, zr = sosfilt_zi(sos) * 0, sosfilt_zi(sos) * 0
        ol[i:i + block], zl = sosfilt(sos, l[i:i + block], zi=zl)
        orr[i:i + block], zr = sosfilt(sos, r[i:i + block], zi=zr)
    return dry * l + 3.2 * ol, dry * r + 3.2 * orr


# The melody, written rather than drawn by chance: each motif is (step, chord
# tone, length in steps), a chord tone being an index into the bar's voicing
# (one octave up). A four-bar phrase: a statement, its echo, a rise, an answer.
MOTIFS = {
    "ethereal": [
        [(0, 2, 6), (6, 1, 2), (8, 3, 8)],
        [(0, 2, 6), (6, 1, 2), (8, 0, 8)],
        [(0, 3, 4), (4, 4, 4), (8, 3, 4), (12, 2, 4)],
        [(0, 1, 8), (8, 0, 8)],
    ],
    "cinematic": [
        [(0, 0, 6), (6, 1, 2), (8, 2, 8)],
        [(0, 2, 4), (4, 1, 4), (8, 0, 8)],
        [(0, 0, 4), (4, 1, 4), (8, 2, 4), (12, 3, 4)],
        [(0, 2, 12), (12, 1, 4)],
    ],
}

# where each part sits in the stereo field, always
PANS = dict(strings=(-0.35, 0.0, 0.35), choir=(-0.5, 0.5), harp=-0.45, glock=0.55, vibes=0.35, horn=-0.2,
            spic_hi=-0.35, spic_lo=0.35)


def sub_drop(seconds=1.4):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f = 34 + 40 * np.exp(-t * 5)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4)


GENRES = {
    "ethereal": dict(bpm=100, reverb=5.0, chords=dm.STYLES["ethereal"]["chords"], scale=[0, 2, 4, 5, 7, 9, 11]),
    "cinematic": dict(bpm=90, reverb=4.2, chords=dm.STYLES["cinematic"]["chords"], scale=[0, 2, 3, 5, 7, 8, 10]),
}


def render(name, seconds=78.0, seed=21):
    G = GENRES[name]
    sy = dm.Synth(seed)
    rng = np.random.default_rng(seed)
    BEAT = 60.0 / G["bpm"]
    STEP, BAR = BEAT / 4, BEAT * 4
    n = int(seconds * SR)
    c = controls(seconds)
    # the pedal: how hard the accelerator is pressed right now (no decay), for the wah
    t_c, speed, accel, steer = dm.simulated_drive(seconds)
    c["pedal"] = follow(np.clip(accel / 5.0, 0, 1) * 0.85 + np.clip(speed / 65, 0, 1) * 0.15, 0.04, 0.2)
    # a hard brake, for the bass hit
    c["hard_brake"] = (accel < -3.5).astype(float)
    # how clear the sound is: by speed first (stopped is a distant haze), the last
    # of it only when pushing or at speed; it moves over a second or two, never snaps
    speed_part = dm.smoothstep(np.minimum(speed, 65), 0, 50)
    clear = np.clip(0.03 + 0.72 * speed_part + 0.35 * c["energy"] - 0.25 * c["brake"], 0, 1)
    c["openness"] = follow(clear, 1.3, 1.8)

    vo = voice_lead(G["chords"], lo=55)
    roots = [ch[0] % 12 + 36 for ch in G["chords"]]
    scale = G["scale"]

    I = lambda *a, **k: Instrument(*a, rng=rng, **k)
    vln, vla, vc = (I("VSCO-2-CE/Strings/Violin Section/susVib"), I("VSCO-2-CE/Strings/Viola Section/susvib"),
                    I("VSCO-2-CE/Strings/Cello Section/susvib"))
    vln_spic, vla_spic, vc_spic = (I("VSCO-2-CE/Strings/Violin Section/Spic"), I("VSCO-2-CE/Strings/Viola Section/spic"),
                                   I("VSCO-2-CE/Strings/Cello Section/spic"))
    vln_trem = I("VSCO-2-CE/Strings/Violin Section/Trem")
    vc_pizz = I("VSCO-2-CE/Strings/Cello Section/pizzT")
    harp = I("VSCO-2-CE/Strings/Harp", octave_fix=0)
    horn, horn_stac = I("VSCO-2-CE/Brass/F Horn/sus"), I("VSCO-2-CE/Brass/F Horn/stac")
    tuba, tuba_stac = I("VSCO-2-CE/Brass/Tuba/sus"), I("VSCO-2-CE/Brass/Tuba/stac")
    piano = I("VCSL/Chordophones/Zithers/Grand Piano, Kawai - Legacy/Sustains")
    glock = I("VCSL/Idiophones/Struck Idiophones/Glockenspiel", match="soft|med|mf|_p")
    glock = glock if glock else I("VCSL/Idiophones/Struck Idiophones/Glockenspiel")
    vib_soft, vib_bow = I("VCSL/Idiophones/Struck Idiophones/Vibraphone/Soft Mallets"), \
        I("VCSL/Idiophones/Struck Idiophones/Vibraphone/Bowed")
    chimes = I("VCSL/Idiophones/Struck Idiophones/Tubular Bells 1")
    marks = I("VCSL/Idiophones/Struck Idiophones/Mark Trees")
    timp = I("VCSL/Membranophones/Struck Membranophones/Timpani 1/Hit")
    bdrum = I("VCSL/Membranophones/Struck Membranophones/Bass Drum 2")
    snr = I("VCSL/Membranophones/Struck Membranophones/Snare Drum, Modern 1")
    tom = I("VCSL/Membranophones/Struck Membranophones/Tom 1/Stick")
    hh = I("VCSL/Idiophones/Struck Idiophones/Hi-Hat Cymbal")
    shk = I("VCSL/Idiophones/Struck Idiophones/Shaker, Small")
    cym = I("VCSL/Idiophones/Struck Idiophones/Suspended Cymbal 1")

    bed = StereoBus(n, verb=0.5)
    shimmer = Bus(n, verb=1.0)
    keys = StereoBus(n, verb=0.5, delay=0.35)
    lead = StereoBus(n, verb=0.42, delay=0.25)
    bass = StereoBus(n, verb=0.05)
    drums = StereoBus(n, verb=0.15)
    surge = StereoBus(n, verb=0.3)
    impact = StereoBus(n, verb=0.3)
    kicks = []
    phrase, prev_mel = [], None
    was_e, was_hb = 0.0, 0.0
    eth = name == "ethereal"

    for bar in range(int(seconds / BAR) + 1):
        bt = bar * BAR
        if bt >= seconds:
            break
        v = vo[bar % len(vo)]
        root = roots[bar % len(roots)]
        stp0, g0 = at(c, "stopped", bt), at(c, "groove", bt)
        lift = 1 + (0.7 if eth else 3.2) * stp0
        hold = BAR + 0.2

        # ---- the bed: string sections, held for the bar
        for m in v:
            inst = vc if m < 55 else (vla if m < 62 else vln)
            bed.add2(inst.note(m, 0.3, hold, 1.2, max_len=BAR + 2), bt, 0.16 * lift,
                     pan=PANS["strings"][0 if m < 55 else (1 if m < 62 else 2)])
        bed.add2(vc.note(v[0] - 12, 0.35, hold, 1.2, max_len=BAR + 2), bt, 0.15 * lift)
        # the choir and shimmer, synthesised
        nn = int((hold + 2.0) * SR)
        for m in v[1:4]:
            bed.add(dm.choir(sy, hz(m), nn) * env(nn, 1.6, 0.6, 0.9, 2.2, hold), bt,
                    (0.05 if eth else 0.04) + (0.05 if eth else 0.09) * stp0, pan=PANS["choir"][m % 2])
        if eth:
            for m in v:
                shimmer.add(np.sin(2 * np.pi * hz(m + 12) * np.arange(nn) / SR) * env(nn, 1.5, 1, 0.8, 2, hold), bt, 0.025)
            if stp0 > 0.3:  # bowed vibraphone glowing over the breakdown
                for m in v[1::2]:
                    keys.add2(vib_bow.note(m + 12, 0.5, hold, 1.5), bt, 0.12 * stp0, pan=PANS["vibes"])
            if bar % 4 == 0:
                keys.add2(chimes.note(v[0] + 12, 0.4, None), bt, 0.10 + 0.06 * stp0)
        else:
            if stp0 > 0.3:  # waiting at a stop: a hushed violin tremolo and a low horn, the tension before the go
                for m in v[1:3]:
                    bed.add2(vln_trem.note(m + 12, 0.35, hold, 1.2, max_len=BAR + 2), bt, 0.5 * stp0, pan=PANS["strings"][2])
                bed.add2(horn.note(v[0], 0.3, hold, 1.5, max_len=BAR + 2), bt, 0.35 * stp0)
            if g0 > 0.3:  # horns swell under the strings once moving
                for m in v[:2]:
                    bed.add2(horn.note(m, 0.35, hold, 1.0, max_len=BAR + 2), bt, 0.11 * g0, pan=PANS["horn"])

        motif = MOTIFS[name][bar % 4]
        top = [m + 12 for m in v]

        for step in range(16):
            st = bt + step * STEP
            if st >= seconds:
                break
            g, e, s, stp = (at(c, k, st) for k in ("groove", "energy", "steer", "stopped"))
            full = e > 0.3 or g > 0.85

            # ---- drums: a synth kick for punch, real everything else
            if g > 0.15:
                k_on = step == 0 or (full and step in (4, 8, 12)) or (not full and step == 10 and bar % 2)
                if not eth:
                    k_on = step in (0, 8) or (full and step in (6, 14))
                if k_on:
                    drums.add(dm.kick(), st, 0.8 if eth else 0.6)
                    kicks.append(st)
                    if not eth:
                        drums.add2(bdrum.hit("hit_(mf|f)", 0.6), st, 0.3)
                if (full and step in (4, 12)) or (not full and step == 8 and g > 0.4):
                    drums.add2(snr.hit("v[45]"), st, 0.32 if eth else 0.38)
                if g > 0.3 and step % 2 == 0:
                    drums.add2(hh.hit("Close|HitC"), st, 0.16 + 0.1 * e, pan=0.3)
                if eth and g > 0.25:
                    drums.add2(shk.hit(), st, 0.18 + 0.12 * e, pan=-0.35)
                if e > 0.35 and bar % 4 == 3 and step >= 12:
                    x = tom.note(64 - 4 * (step - 12)) if tom.keys.size else tom.hit()
                    drums.add2(x if x is not None else tom.hit(), st, 0.35, pan=0.5 - 0.33 * (step - 12))
            # the door throws open: crash (and in Cinematic the big drums)
            if e > 0.5 and was_e <= 0.5 and g > 0.6:
                impact.add2(cym.hit("hit|crash|_f|ff"), st, 0.35)
                impact.add(dm.crash(sy), st, 0.35)
                if eth:
                    impact.add2(marks.hit("fastAsc|Asc"), st, 0.35)
                else:
                    impact.add2(timp.hit("v[45]"), st, 0.5)
                    impact.add2(bdrum.hit("ff"), st, 0.45)
            was_e = e
            # a hard brake: the bass hit
            hb = at(c, "hard_brake", st)
            if hb > 0.5 and was_hb <= 0.5:
                impact.add(sub_drop(), st, 0.9)
                impact.add2(bdrum.hit("hit_ff|hit_f"), st, 0.8)
                if not eth:
                    impact.add2(timp.hit("v[45]"), st, 0.7)
            was_hb = hb

            # ---- bass: a synth sub for weight, and a recorded one over it
            if g > 0.12 and step in (0, 3, 6, 10, 14) + ((8, 12) if e > 0.4 else ()):
                ln = STEP * (2.6 if step in (0, 6, 10) else 1.4)
                nn2 = int((ln + 0.15) * SR)
                f = hz(root)
                bass.add(np.sin(2 * np.pi * f * np.arange(nn2) / SR) * env(nn2, 0.006, 0.12, 0.75, 0.08, ln), st,
                         0.26 * g + 0.08 * e)
                rec = (vc_pizz if eth else (tuba_stac if step % 4 == 0 else vc_spic)).note(root + 12, 0.5 + 0.3 * e, ln, 0.15)
                bass.add2(rec, st, 0.2 * g + 0.1 * e)

            # ---- motion: harp and sparkle (Ethereal), driving spiccato strings (Cinematic)
            if eth:
                # the harp: up and back down the chord in eighths, every bar the same shape
                if step % 2 == 0:
                    m = v[(0, 1, 2, 3, 4, 3, 2, 1)[(step // 2) % 8] % len(v)] + 12
                    keys.add2(harp.note(m, 0.45), st, 0.2 + 0.08 * stp, pan=PANS["harp"])
                # the glockenspiel: the chord's top note, once, at the start of each phrase
                if step == 0 and bar % 2 == 0:
                    keys.add2(glock.note(v[-1] + 24, 0.3), st, 0.1, pan=PANS["glock"])
                # the vibraphone: the chord's middle, on beats one and three, once moving
                if step in (0, 8) and g > 0.2:
                    keys.add2(vib_soft.note(v[2] + 12, 0.4, None), st, 0.12, pan=PANS["vibes"])
            else:
                if (g > 0.2 or stp > 0.5) and (step % 2 == 0 or e > 0.3):
                    m = v[(0, 1, 2, 1)[(step // 2) % 4]] + 12
                    inst = vln_spic if m >= 62 else vla_spic
                    keys.add2(inst.note(m, 0.4 + 0.4 * e), st, 0.22 + 0.1 * g, pan=-0.35)
                    keys.add2(vc_spic.note(v[0], 0.4 + 0.4 * e), st, 0.15 * g, pan=0.35)
                if e > 0.25 and step == 0:  # a tremolo surge on a push
                    for m in v[:3]:
                        surge.add2(vln_trem.note(m + 12, 0.7, BAR, 0.4), st, 0.12 * e, pan=PANS["strings"][2])

            # ---- the surge on a pull, through the wah
            if e > 0.08 and step in (0, 3, 6, 10, 12):
                ln = STEP * 1.4
                nn2 = int((ln + 0.2) * SR)
                if eth:
                    for m in v[:4]:
                        surge.add(sy.supersaw(hz(m), nn2) * env(nn2, 0.004, 0.15, 0.55, 0.15, ln), st, 0.06 * e,
                                  pan=-0.6 if m % 2 else 0.6)
                else:
                    for m in v[:2]:
                        surge.add2(horn_stac.note(m, 0.8), st, 0.25 * e, pan=PANS["horn"])
                    surge.add2(tuba_stac.note(root, 0.8), st, 0.25 * e)

            # ---- melody: piano (Ethereal) or horn (Cinematic), leaning to the outside of the turn
            for (ms, tone, ln) in motif:
                if ms != step or g <= 0.3:
                    continue
                m = top[tone % len(top)]
                dur = STEP * ln
                pan = float(np.clip(-s * 1.1, -0.9, 0.9))
                if eth:
                    lead.add2(piano.note(m, 0.45 + 0.2 * abs(s), dur + 0.6, 0.5), st, 0.33 + 0.12 * abs(s), pan=pan)
                else:
                    lead.add2(horn.note(m - 12, 0.5 + 0.2 * abs(s), dur, 0.3), st, 0.3 + 0.1 * abs(s), pan=pan)

    # ---- the pump
    duck = np.ones(n)
    for k in kicks:
        i = int(k * SR)
        e = at(c, "energy", k)
        ln = min(int(0.3 * SR), n - i)
        duck[i:i + ln] = np.minimum(duck[i:i + ln], 1 - (0.15 + 0.35 * e) * np.exp(-np.arange(ln) / SR * 10))
    for b in (bed, keys, surge):
        b.l *= duck
        b.r *= duck

    # ---- the wah on the surge, following the pedal
    surge.l, surge.r = wah(surge.l, surge.r, lambda tt: at(c, "pedal", tt))

    buses = [bed, shimmer, keys, lead, bass, drums, surge, impact]
    dry_l = sum(b.l for b in buses if b is not shimmer)
    dry_r = sum(b.r for b in buses if b is not shimmer)
    dl, dr = np.zeros(n), np.zeros(n)
    for b in buses:
        if b.delay:
            el, er = ping_pong(b.l * b.delay, b.r * b.delay, STEP * 3)
            dl, dr = dl + el, dr + er
    irl, irr = reverb_ir(sy, G["reverb"])
    send_l = sum(b.l * b.verb for b in buses) + dl * 0.5
    send_r = sum(b.r * b.verb for b in buses) + dr * 0.5
    wet_l = hp(fftconvolve(send_l, irl)[:n], 180, 1) * 1.4
    wet_r = hp(fftconvolve(send_r, irr)[:n], 180, 1) * 1.4
    l = dry_l + dl + wet_l
    r = dry_r + dr + wet_r
    # the haze: mostly the hall's wash and little of the instruments themselves,
    # dark and far away; this is what's heard stopped
    haze_l = lp(lp(0.25 * (dry_l + dl) + 1.3 * wet_l, 700), 700)
    haze_r = lp(lp(0.25 * (dry_r + dr) + 1.3 * wet_r, 700), 700)

    # ---- the door
    t = np.arange(n) / SR
    o = np.interp(t, np.arange(len(c["openness"])) / CTRL, c["openness"])
    w = o ** 1.3
    shut_l, shut_r = haze_l, haze_r
    g_shut = 10 ** (-11 / 20)
    mid = w * (l + r) / 2 + (1 - w) * (shut_l + shut_r) / 2 * g_shut
    side = w * (l - r) / 2 + (1 - w) * (shut_l - shut_r) / 2 * g_shut * 0.35
    l, r = mid + side, mid - side

    # ---- the turn: the music swings to the outside (turning right moves it left)
    st_curve = np.interp(t, np.arange(len(c["steer"])) / CTRL, c["steer"])
    l = l * (1 - 0.75 * np.clip(-st_curve, 0, 1))
    r = r * (1 - 0.75 * np.clip(st_curve, 0, 1))

    mix = np.stack([l, r], axis=1)
    # level by the music, not by its single loudest drum hit: the top 0.2% of
    # peaks (the big hits) go into a soft limiter instead of turning everything down
    mix /= np.percentile(np.abs(mix), 99.8) + 1e-9
    mix = np.tanh(mix * 0.9) / np.tanh(1.4) * 0.89
    f = int(0.05 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-int(2.5 * SR):] *= np.linspace(1, 0, int(2.5 * SR))[:, None]
    return mix


if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if a in GENRES] or list(GENRES)
    os.makedirs("samples", exist_ok=True)
    for nm in names:
        out = os.path.join("samples", f"drive-mode-{nm}.wav")
        dm.write_wav(out, render(nm))
        print("wrote", out)
