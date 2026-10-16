"""
Drive Mode, prototype (v3): generated music that follows a drive, in several genres.

Renders WAVs from a simulated drive so the musical rules can be heard and tuned
before they go into the companion app, where the same rules run live from the
phone's GPS and motion sensors. Nothing is recorded: every sound is synthesised.

The drive shapes every genre the same way:
  openness      the master "door": stopped, the music is heard muffled and
                narrow, as if through a closed door; pushing throws it wide open
                in under a tenth of a second (a crossfade, never a filter sweep);
                cruising sits mostly open; easing off and braking let it close
  speed         how much of the band plays (the groove)
  acceleration  the surge, decaying over ~3 s; a hard pull gets a swell and a crash
  steering      the lead swells and pans to the turn
  stopped       a breakdown, each genre its own
  above ~65 mph nothing builds further

A genre (STYLES) is its tempo, swing, chords and the instruments and beats it
plays them with.

    python drive_music.py                 # every genre, into samples/
    python drive_music.py synthwave out.wav
"""

import os
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt, sosfilt_zi

SR = 44100
CTRL = 100


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


# ================================================================ the drive
def simulated_drive(seconds):
    t = np.arange(0, seconds, 1 / CTRL)
    keys = [(0, 0), (9.6, 0), (19, 45), (31, 45), (40, 44), (41, 45), (48, 65),
            (60, 65), (67, 0), (seconds, 0)]
    kt, kv = zip(*keys)
    speed = np.interp(t, kt, kv)
    speed += np.where(speed > 40, 0.8 * np.sin(t * 0.9), 0)
    accel = np.convolve(np.gradient(speed, 1 / CTRL), np.ones(30) / 30, mode="same")
    steer = np.zeros_like(t)
    for start, end, side in [(31.5, 35.5, -1.0), (35.8, 39.8, 1.0)]:
        m = (t >= start) & (t <= end)
        steer[m] = side * np.sin(np.pi * (t[m] - start) / (end - start)) * 0.9
    return t, speed, accel, steer


def follow(x, attack, release):
    y = np.zeros_like(x)
    up, dn = 1 - np.exp(-1 / (CTRL * attack)), 1 - np.exp(-1 / (CTRL * release))
    for i in range(1, len(x)):
        y[i] = y[i - 1] + (up if x[i] > y[i - 1] else dn) * (x[i] - y[i - 1])
    return y


def smoothstep(x, lo, hi):
    u = np.clip((x - lo) / (hi - lo), 0, 1)
    return u * u * (3 - 2 * u)


def controls(seconds):
    t, speed, accel, steer = simulated_drive(seconds)
    capped = np.minimum(speed, 65)
    pull = np.clip(accel / 5.0, 0, 1)
    groove = follow(smoothstep(capped, 3, 40), 0.6, 1.5)
    energy = follow(pull * (0.55 + 0.45 * smoothstep(capped, 0, 30)), 0.25, 3.0)
    brake = follow(np.clip(-accel / 6.0, 0, 1), 0.15, 0.8)
    stopped = follow((speed < 1.0).astype(float), 1.0, 0.5)
    # how open the whole sound is: shut stopped, part open cruising, wide open on a pull
    # snaps open the moment you push (no sweep), settles closed over a second or two
    target = np.clip(0.25 + 0.55 * groove - 0.6 * brake, 0, 1)
    # clearly pushing: all the way, at once
    target = np.where(follow(pull, 0.05, 0.4) > 0.25, 1.0, target)
    openness = follow(target, 0.06, 1.4)
    return dict(groove=groove, energy=energy, brake=brake, stopped=stopped,
                steer=follow(steer, 0.12, 0.3), build=follow(np.clip(accel / 2.0, 0, 1), 0.05, 0.6),
                openness=openness)


def at(c, k, s):
    return float(c[k][min(int(s * CTRL), len(c[k]) - 1)])


# ================================================================ sounds
class Synth:
    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)

    def phase(self, f, n):
        return (self.rng.random() + np.cumsum(np.full(n, f) if np.isscalar(f) else f) / SR) % 1.0

    def saw(self, f, n):
        return 2 * self.phase(f, n) - 1

    def tri(self, f, n):
        return 2 * np.abs(2 * self.phase(f, n) - 1) - 1

    def pulse(self, f, n, w=0.3):
        return np.where(self.phase(f, n) < w, 1.0, -1.0)

    def supersaw(self, f, n, voices=7, spread=0.016):
        return sum(self.saw(f * (1 + spread * (v / (voices - 1) - 0.5) * 2), n) for v in range(voices)) / voices

    def noise(self, n):
        return self.rng.standard_normal(n)


def env(n, a, d, s, r, hold):
    e = np.zeros(n)
    ia = max(int(a * SR), 1)
    e[: min(ia, n)] = np.linspace(0, 1, ia)[: n]
    ed = min(ia + max(int(d * SR), 1), n)
    if ed > ia:
        e[ia:ed] = np.linspace(1, s, ed - ia)
    ih = min(int(hold * SR), n)
    if ih > ed:
        e[ed:ih] = s
    if ih < n:
        k = min(max(int(r * SR), 1), n - ih)
        e[ih:ih + k] = e[max(ih - 1, 0)] * np.linspace(1, 0, k)
    return e


def lp(sig, fc, order=2):
    return sosfilt(butter(order, min(fc, SR / 2 - 100), "lp", fs=SR, output="sos"), sig)


def hp(sig, fc, order=2):
    return sosfilt(butter(order, fc, "hp", fs=SR, output="sos"), sig)


def bp(sig, lo, hi):
    return sosfilt(butter(2, [lo, hi], "bandpass", fs=SR, output="sos"), sig)


_formants = [butter(2, [fc * 0.85, fc * 1.15], "bandpass", fs=SR, output="sos") for fc in (800, 1150, 2900)]


def choir(sy, f, n):
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * np.arange(n) / SR + sy.rng.random() * 6)
    src = sum(2 * sy.phase(f * vib * (1 + d), n) - 1 for d in (-0.006, 0, 0.007)) / 3
    return sum(g * sosfilt(sos, src) for sos, g in zip(_formants, (1.0, 0.6, 0.25))) * 2.2


def fm(f, n, ratio, index, idx_decay, amp_decay):
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t * idx_decay)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t * amp_decay)


def epiano(f, n):
    """a Rhodes-like electric piano: FM tine plus a soft tremolo"""
    t = np.arange(n) / SR
    tone = fm(f, n, 1.0, 1.8, 6, 1.6) + 0.35 * fm(f, n, 14.0, 0.6, 30, 9)
    return tone * (1 + 0.15 * np.sin(2 * np.pi * 4.5 * t))


def soft_lead(f, n, glide_from=None, vib=0.006):
    t = np.arange(n) / SR
    freq = f * (1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.clip(t * 3, 0, 1))
    if glide_from:
        freq = freq * (1 + (glide_from / f - 1) * np.exp(-t * 25))
    p = np.cumsum(freq) / SR
    return 0.8 * np.sin(2 * np.pi * p) + 0.12 * np.sin(4 * np.pi * p)


def kick(punch=1.0, tail=6.5):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 42 + 115 * punch * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * tail) * 1.05


def snare(sy, ghost=False, tone=190, bright=6000):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t * 22) * 0.45
    noise = bp(sy.noise(n), 1200, bright) * np.exp(-t * (26 if ghost else 13))
    return (body + noise) * (0.25 if ghost else 1.0)


def gated_snare(sy):
    """the 80s snare: a short burst of big reverb, cut off hard"""
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    dry = snare(sy, tone=180, bright=7000)[: n] if n <= int(0.3 * SR) else np.pad(snare(sy, tone=180, bright=7000), (0, n - int(0.3 * SR)))
    room = bp(sy.noise(n), 900, 6000) * 0.55
    gate = np.where(t < 0.28, 1.0, np.exp(-(t - 0.28) * 60))
    return dry + room * gate


def hat(sy, open_=False):
    n = int((0.35 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return hp(sy.noise(n), 7000) * np.exp(-t * (8 if open_ else 70)) * 0.3


def shaker(sy):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return hp(sy.noise(n), 9000) * np.minimum(t / 0.015, 1) * np.exp(-t * 30) * 0.22


def tom(f):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(f * (1 + 0.6 * np.exp(-t * 25))) / SR) * np.exp(-t * 7) * 0.6


def taiko(sy):
    """a big low drum for the cinematic pulls"""
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * np.cumsum(60 * (1 + 0.5 * np.exp(-t * 18))) / SR) * np.exp(-t * 4.5)
    skin = lp(sy.noise(n), 900) * np.exp(-t * 20) * 0.6
    return (body + skin) * 1.1


def crash(sy):
    n = int(3.0 * SR)
    t = np.arange(n) / SR
    return hp(sy.noise(n), 3500) * np.exp(-t * 1.3) * 0.12


def reverse_swell(sy, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return bp(sy.noise(n), 2000, 9000) * (t / dur) ** 2.5 * 0.35


def vinyl(sy, n):
    """lo-fi dust: a quiet hiss with scattered crackles"""
    hiss = lp(sy.noise(n), 6000) * 0.006
    pops = np.zeros(n)
    idx = sy.rng.integers(0, n, n // 2500)
    pops[idx] = sy.rng.uniform(-1, 1, len(idx)) * 0.25
    return hiss + hp(pops, 1500)


# ================================================================ mixing
class Bus:
    def __init__(self, n, verb=0.0, delay=0.0):
        self.l, self.r = np.zeros(n), np.zeros(n)
        self.verb, self.delay = verb, delay

    def add(self, sig, start, gain=1.0, pan=0.0, haas=0.0):
        i = int(start * SR)
        if i >= len(self.l) or i < 0 or gain <= 0:
            return
        sig = sig[: len(self.l) - i] * gain
        a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        self.l[i:i + len(sig)] += sig * np.cos(a)
        j = i + int(haas * SR)
        if j < len(self.r):
            k = min(len(sig), len(self.r) - j)
            self.r[j:j + k] += sig[:k] * np.sin(a)


def moving_filter_lr(l, r, cutoff_at, kind="lp", block=512):
    ol, orr = np.zeros_like(l), np.zeros_like(r)
    zl = zr = None
    for i in range(0, len(l), block):
        fc = float(np.clip(cutoff_at(i / SR), 80, 18500))
        sos = butter(2, fc, kind, fs=SR, output="sos")
        if zl is None:
            zl, zr = sosfilt_zi(sos) * 0, sosfilt_zi(sos) * 0
        ol[i:i + block], zl = sosfilt(sos, l[i:i + block], zi=zl)
        orr[i:i + block], zr = sosfilt(sos, r[i:i + block], zi=zr)
    return ol, orr


def reverb_ir(sy, seconds, predelay=0.03, dark=2500):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = []
    for _ in range(2):
        nz = sy.noise(n) * np.exp(-t * 6.9 / seconds)
        d = lp(nz, dark, order=1)
        mix = nz * np.exp(-t * 2.5) + d * (1 - np.exp(-t * 2.5))
        ir = np.concatenate([np.zeros(int(predelay * SR)), mix])
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return out


def ping_pong(l, r, time, feedback=0.42, repeats=6):
    d = int(time * SR)
    ol, orr = np.zeros_like(l), np.zeros_like(r)
    src = (l + r) / 2
    g = 1.0
    for k in range(1, repeats + 1):
        g *= feedback
        sh = d * k
        if sh >= len(src):
            break
        (ol if k % 2 else orr)[sh:] += src[:-sh] * g
    return ol, orr


def voice_lead(chords, lo=55):
    out, prev = [], None
    for notes in chords:
        pcs = sorted({n % 12 for n in notes})
        best, cost = None, 1e9
        for base in range(lo - 3, lo + 9):
            v = sorted(base + ((pc - base) % 12) for pc in pcs)
            v = sorted(n + 12 if n < lo else n for n in v)
            c = 0 if prev is None else sum(min(abs(a - b) for b in prev) for a in v)
            if c < cost:
                best, cost = v, c
        out.append(best)
        prev = best
    return out


# ================================================================ the genres
STYLES = {
    "ethereal": dict(
        bpm=100, swing=0.0, reverb=5.0, verb_dark=2500,
        chords=[[48, 52, 55, 59, 62], [45, 48, 52, 55, 62], [41, 45, 48, 52, 59], [43, 47, 50, 52, 57],
                [40, 43, 47, 50, 54], [45, 48, 52, 55, 59], [38, 41, 45, 48, 55], [43, 48, 50, 53, 57, 64]],
        scale=[0, 2, 4, 5, 7, 9, 11],
        bed="tri+choir+shimmer", keys="bell", lead="soft", bass="sub", drums="modern", surge="supersaw",
        atmos="wind",
    ),
    "cinematic": dict(
        bpm=90, swing=0.0, reverb=4.2, verb_dark=2200,
        chords=[[45, 48, 52], [41, 45, 48], [36, 40, 43], [43, 47, 50],
                [45, 48, 52], [38, 41, 45], [41, 45, 48], [40, 44, 47]],
        scale=[0, 2, 3, 5, 7, 8, 10],
        bed="strings+choir", keys="ostinato", lead="horn", bass="low_brass", drums="epic", surge="taiko",
        atmos="wind",
    ),
}


def melody_phrase(bar, voicing, prev_note, scale, rng_seed):
    rng = np.random.default_rng(rng_seed + bar // 2 % 4)
    rhythm = [0, 3, 6, 8, 10, 14] if bar % 4 < 2 else [0, 2, 4, 7, 10, 12]
    cur = prev_note or voicing[1] + 12
    notes = []
    for st in rhythm:
        if st in (0, 8):
            target = min((v + 12 for v in voicing), key=lambda v: abs(v - cur))
        else:
            target = cur + int(rng.choice([-2, -1, 1, 2, 3]))
            while target % 12 not in scale:
                target += 1
        target = int(np.clip(target, 65, 86))
        notes.append((st, target, 2 if st not in (6, 14) else 1.5))
        cur = target
    return notes, cur


def render(style_name, seconds=78.0, seed=11):
    S = STYLES[style_name]
    sy = Synth(seed)
    BEAT = 60.0 / S["bpm"]
    STEP = BEAT / 4
    BAR = BEAT * 4
    n = int(seconds * SR)
    c = controls(seconds)
    voicings = voice_lead(S["chords"])
    roots = [ch[0] % 12 + 36 for ch in S["chords"]]
    scale = S["scale"]

    bed = Bus(n, verb=0.55)
    shimmer = Bus(n, verb=1.0)
    keys = Bus(n, verb=0.45, delay=0.4)
    lead = Bus(n, verb=0.4, delay=0.3)
    bass = Bus(n, verb=0.04)
    drums = Bus(n, verb=0.12)
    surge = Bus(n, verb=0.35)
    atmos = Bus(n, verb=0.6)
    kicks = []
    phrase, prev_mel, prev_lead_f = [], None, None
    was_e, swelled_for = 0.0, -1

    def swing_t(step):
        return STEP * (S["swing"] - 0.5) * 2 * 0.5 if (step % 2 and S["swing"]) else 0.0

    bars = int(seconds / BAR) + 1
    for bar in range(bars):
        bt = bar * BAR
        if bt >= seconds:
            break
        v = voicings[bar % len(voicings)]
        root = roots[bar % len(roots)]
        stp0, g0 = at(c, "stopped", bt), at(c, "groove", bt)
        lift = 1 + 0.8 * stp0  # the breakdown carries the sound on its own
        hold = BAR + 0.3
        nn = int((hold + 2.0) * SR)

        # ---- the bed: the chord for the whole bar
        if "tri" in S["bed"]:
            for m in v:
                bed.add(sy.tri(hz(m), nn) * env(nn, 1.2, 0.8, 0.85, 2.0, hold), bt, 0.07 * lift,
                        pan=sy.rng.uniform(-0.4, 0.4), haas=0.012)
        if "brass" in S["bed"]:
            for m in v:
                sig = lp(sy.supersaw(hz(m), nn, voices=5, spread=0.01), 2200) * env(nn, 0.25, 0.6, 0.75, 1.2, hold)
                bed.add(sig, bt, 0.075 * lift, pan=sy.rng.uniform(-0.5, 0.5), haas=0.015)
        if "strings" in S["bed"]:
            for m in v + [v[0] - 12]:
                vib = 1 + 0.003 * np.sin(2 * np.pi * 5.0 * np.arange(nn) / SR)
                sig = lp(sy.supersaw(hz(m) * vib, nn, voices=6, spread=0.008), 3200)
                bed.add(sig * env(nn, 1.4, 0.8, 0.9, 1.8, hold), bt, 0.07 * lift, pan=sy.rng.uniform(-0.6, 0.6), haas=0.01)
        if "epiano" in S["bed"]:
            # comped: the chord on 1 and the and of 2, a little loose
            for when, vel in ((0, 1.0), (6, 0.7), (11, 0.5)):
                for m in v:
                    st = bt + when * STEP + sy.rng.uniform(0, 0.012)
                    keys_n = int(2.6 * SR)
                    bed.add(epiano(hz(m), keys_n), st, 0.07 * vel * lift, pan=sy.rng.uniform(-0.4, 0.4))
        if "choir" in S["bed"]:
            for m in v[1:4]:
                bed.add(choir(sy, hz(m), nn) * env(nn, 1.6, 0.6, 0.9, 2.2, hold), bt,
                        0.05 + 0.07 * stp0 + 0.02 * g0, pan=sy.rng.uniform(-0.6, 0.6))
        if "shimmer" in S["bed"]:
            for m in v:
                shimmer.add(np.sin(2 * np.pi * hz(m + 12) * np.arange(nn) / SR) * env(nn, 1.5, 1, 0.8, 2, hold), bt, 0.03)

        if bar % 2 == 0:
            phrase, prev_mel = melody_phrase(bar, v, prev_mel, scale, 1000 + hash(style_name) % 97)

        for step in range(16):
            st = bt + step * STEP + swing_t(step)
            if st >= seconds:
                break
            g, e, s, stp = (at(c, k, st) for k in ("groove", "energy", "steer", "stopped"))
            full = e > 0.3 or g > 0.85

            # ---- drums
            dk = S["drums"]
            if g > 0.15:
                kick_on = (step == 0) or (full and step in (4, 8, 12)) or (not full and step == 10 and bar % 2)
                if dk == "dusty":
                    kick_on = step in (0, 7, 10) if full else step in (0, 10)
                if dk == "epic":
                    kick_on = step in (0, 8) or (full and step in (6, 14))
                if kick_on:
                    drums.add(kick(punch=0.8 if dk == "dusty" else 1.0, tail=9 if dk == "dusty" else 6.5), st, 0.9)
                    kicks.append(st)
                snare_on = (full and step in (4, 12)) or (not full and step == 8 and g > 0.4)
                if dk == "dusty":
                    snare_on = step in (4, 12) and g > 0.3
                if snare_on:
                    sn = gated_snare(sy) if dk == "eighties" else snare(sy, bright=4000 if dk == "dusty" else 6000)
                    drums.add(sn, st, 0.5 if dk != "epic" else 0.4)
                if dk in ("modern", "dusty") and g > 0.45 and step in (7, 11, 15) and sy.rng.random() < 0.5:
                    drums.add(snare(sy, ghost=True), st, 0.5, pan=0.15)
                if g > 0.3 and (step % 2 == 0 or (dk == "eighties" and e > 0.3)):
                    drums.add(hat(sy), st, (0.22 + 0.15 * e) * (0.7 if dk == "dusty" else 1), pan=0.3)
                if dk == "modern" and g > 0.25:
                    drums.add(shaker(sy), st, 0.5 + 0.3 * e, pan=-0.35)
                if e > 0.6 and step % 4 == 2 and dk != "dusty":
                    drums.add(hat(sy, open_=True), st, 0.32, pan=-0.15)
                if e > 0.35 and bar % 4 == 3 and step >= 12 and dk in ("modern", "eighties", "epic"):
                    drums.add(tom(140 - 18 * (step - 12)), st, 0.6, pan=0.5 - 0.33 * (step - 12))
            if e > 0.5 and was_e <= 0.5:
                drums.add(crash(sy), st, 1.0)
                if S["surge"] == "taiko":
                    drums.add(taiko(sy), st, 1.0)
            was_e = e

            # ---- bass
            bk = S["bass"]
            if g > 0.12:
                if bk == "rolling":
                    # synthwave: sixteenth octaves, always rolling once moving
                    if step % 1 == 0 and (g > 0.3 or step % 2 == 0):
                        ln = STEP * 0.8
                        nn2 = int((ln + 0.08) * SR)
                        f = hz(root + (12 if step % 2 else 0))
                        sig = lp(sy.saw(f, nn2), 500 + 1500 * e) * env(nn2, 0.003, 0.06, 0.6, 0.04, ln)
                        bass.add(sig, st, 0.22 * g + 0.1 * e)
                elif step in (0, 3, 6, 10, 14) + ((8, 12) if e > 0.4 else ()):
                    ln = STEP * (2.6 if step in (0, 6, 10) else 1.4)
                    nn2 = int((ln + 0.15) * SR)
                    f = hz(root + (12 if step == 14 and e > 0.3 else 0))
                    t = np.arange(nn2) / SR
                    if bk == "low_brass":
                        sig = lp(sy.saw(f, nn2), 250 + 900 * e) * env(nn2, 0.06, 0.2, 0.8, 0.2, ln)
                    elif bk == "round":
                        sig = (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)) * env(nn2, 0.01, 0.3, 0.5, 0.1, ln)
                    else:
                        sig = (0.9 * np.sin(2 * np.pi * f * t) + 0.45 * lp(sy.saw(f, nn2), 300 + 700 * e)) \
                            * env(nn2, 0.006, 0.12, 0.75, 0.08, ln)
                    bass.add(sig, st, 0.3 * g + 0.1 * e)

            # ---- keys: bells, an 80s arpeggio, or a string ostinato
            kk = S["keys"]
            if kk == "bell" and step % 2 == 0 and sy.rng.random() < 0.55 + 0.35 * stp - 0.2 * e:
                m = v[[0, 2, 4, 1, 3, 4, 2, 0][(step // 2) % 8] % len(v)] + 12 + (12 if step % 8 == 6 else 0)
                keys.add(fm(hz(m), int(2.2 * SR), 3.5, 3.2, 3.0, 2.2), st, 0.05 + 0.03 * stp, pan=sy.rng.uniform(-0.7, 0.7))
            if kk == "arp":
                m = v[step % len(v)] + 12 * (1 + (step // 4) % 2)
                nn2 = int(STEP * 1.2 * SR)
                sig = lp(sy.pulse(hz(m), nn2, 0.25), 1800 + 3000 * g) * env(nn2, 0.002, 0.08, 0.3, 0.05, STEP * 0.7)
                keys.add(sig, st, 0.045 + 0.07 * stp, pan=0.4 if step % 2 else -0.4)
            if kk == "ostinato" and (g > 0.2 or stp > 0.5) and step % 2 == 0:
                m = v[(0, 1, 2, 1)[(step // 2) % 4]] + 12
                nn2 = int(STEP * 1.6 * SR)
                sig = lp(sy.supersaw(hz(m), nn2, voices=4, spread=0.01), 2500) * env(nn2, 0.01, 0.1, 0.4, 0.06, STEP * 1.1)
                keys.add(sig, st, 0.05 + 0.03 * g, pan=-0.3)

            # ---- surge on a pull
            sk = S["surge"]
            if e > 0.08:
                if sk == "supersaw" and step in (0, 3, 6, 10, 12):
                    ln = STEP * 1.4
                    nn2 = int((ln + 0.2) * SR)
                    for m in v[:4]:
                        surge.add(sy.supersaw(hz(m), nn2) * env(nn2, 0.004, 0.15, 0.55, 0.15, ln), st, 0.05 * e,
                                  pan=sy.rng.uniform(-0.8, 0.8))
                if sk == "brass_stab" and step in (0, 6, 12):
                    ln = STEP * 2.2
                    nn2 = int((ln + 0.2) * SR)
                    for m in v:
                        sig = lp(sy.supersaw(hz(m + 12), nn2, voices=5, spread=0.012), 1500 + 5000 * e)
                        surge.add(sig * env(nn2, 0.02, 0.2, 0.6, 0.2, ln), st, 0.06 * e, pan=sy.rng.uniform(-0.7, 0.7))
                if sk == "epiano_stab" and step in (3, 14):
                    for m in v:
                        surge.add(epiano(hz(m + 12), int(1.2 * SR)), st, 0.05 * e, pan=sy.rng.uniform(-0.5, 0.5))
                if sk == "taiko" and step in (0, 8, 14) and e > 0.25:
                    drums.add(taiko(sy), st, 0.6 * e)
                if sk in ("supersaw", "brass_stab"):
                    m = v[step % len(v)] + 12 * (1 + step % 2)
                    nn2 = int(STEP * 0.9 * SR)
                    surge.add(sy.supersaw(hz(m), nn2, voices=3) * env(nn2, 0.002, 0.05, 0.3, 0.04, STEP * 0.6), st,
                              0.04 * e, pan=0.6 if step % 2 else -0.6)

            # ---- melody (call on even bars, the answer a third down on odd ones)
            lk = S["lead"]
            for (ms, mm, ln) in phrase:
                if ms != step or g <= 0.3:
                    continue
                m = mm
                if bar % 2 == 1:
                    m = mm - 3
                    while m % 12 not in scale:
                        m -= 1
                dur = STEP * 2 * ln
                nn2 = int((dur + 0.5) * SR)
                f = hz(m)
                if lk == "pulse":
                    sig = lp(sy.pulse(f, nn2, 0.4), 3500) * env(nn2, 0.01, 0.2, 0.6, 0.3, dur)
                elif lk == "horn":
                    sig = lp(sy.saw(f, nn2), 1400 + 1500 * g) * env(nn2, 0.12, 0.3, 0.8, 0.4, dur)
                    f = hz(m - 12)
                elif lk == "flute":
                    sig = (soft_lead(f, nn2, prev_lead_f, vib=0.008) + 0.08 * lp(sy.noise(nn2), 3000)) \
                        * env(nn2, 0.06, 0.2, 0.7, 0.3, dur)
                else:
                    sig = soft_lead(f, nn2, prev_lead_f) * env(nn2, 0.04, 0.2, 0.7, 0.35, dur)
                prev_lead_f = f
                lead.add(sig, st, 0.065 + 0.08 * abs(s) + 0.03 * g, pan=float(np.clip(s * 1.1, -0.9, 0.9)))

    # ---- atmosphere
    t = np.arange(n) / SR
    stopped_curve = np.interp(t, np.arange(len(c["stopped"])) / CTRL, c["stopped"])
    if S["atmos"] == "wind":
        wind = bp(sy.noise(n), 300, 1800) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t))
        atmos.add(wind * (0.015 + 0.03 * stopped_curve), 0)
        for _ in range(int(seconds * 1.2)):
            when = sy.rng.uniform(0, seconds)
            if sy.rng.random() < 0.35 + 0.6 * at(c, "stopped", when):
                m = 84 + int(sy.rng.choice([0, 2, 4, 7, 9, 12]))
                nn2 = int(1.5 * SR)
                atmos.add(np.sin(2 * np.pi * hz(m) * np.arange(nn2) / SR) * np.exp(-np.arange(nn2) / SR * 4), when,
                          0.03, pan=sy.rng.uniform(-1, 1))
    if S["atmos"] == "vinyl":
        atmos.add(vinyl(sy, n), 0, 1.0)

    # ---- the pump: the bed ducks under each kick, more when pushing
    duck = np.ones(n)
    for k in kicks:
        i = int(k * SR)
        e = at(c, "energy", k)
        ln = min(int(0.3 * SR), n - i)
        seg = 1 - (0.2 + 0.4 * e) * np.exp(-np.arange(ln) / SR * 10)
        duck[i:i + ln] = np.minimum(duck[i:i + ln], seg)
    for b in (bed, surge, keys):
        b.l *= duck
        b.r *= duck

    buses = [bed, shimmer, keys, lead, bass, drums, surge, atmos]
    dry_l = sum(b.l for b in buses if b is not shimmer)
    dry_r = sum(b.r for b in buses if b is not shimmer)
    dl, dr = np.zeros(n), np.zeros(n)
    for b in buses:
        if b.delay:
            el, er = ping_pong(b.l * b.delay, b.r * b.delay, STEP * 3)
            dl += el
            dr += er
    irl, irr = reverb_ir(sy, S["reverb"], dark=S["verb_dark"])
    send_l = sum(b.l * b.verb for b in buses) + dl * 0.5
    send_r = sum(b.r * b.verb for b in buses) + dr * 0.5
    wet_l = hp(fftconvolve(send_l, irl)[:n], 180, 1)
    wet_r = hp(fftconvolve(send_r, irr)[:n], 180, 1)
    l = dry_l + dl + wet_l * 1.5
    r = dry_r + dr + wet_r * 1.5

    # ---- the open-up: a muffled copy (as if through a closed door) and the full
    # sound, crossfaded by how open the drive has it. A fixed filter, so nothing
    # sweeps: pushing throws the door open, easing off lets it close
    o_curve = np.interp(t, np.arange(len(c["openness"])) / CTRL, c["openness"])
    shut_l, shut_r = lp(lp(l, 900), 900), lp(lp(r, 900), 900)
    w = o_curve ** 1.5
    gain_shut = 10 ** (-7 / 20)
    mid_o, side_o = (l + r) / 2, (l - r) / 2
    mid_s = (shut_l + shut_r) / 2 * gain_shut
    side_s = (shut_l - shut_r) / 2 * gain_shut * 0.35  # shut is narrower too
    mid, side = w * mid_o + (1 - w) * mid_s, w * side_o + (1 - w) * side_s
    l, r = mid + side, mid - side

    mix = np.stack([l, r], axis=1)
    mix /= np.max(np.abs(mix)) + 1e-9
    mix = np.tanh(mix * 1.6) / np.tanh(1.6)
    mix *= 0.89
    f = int(0.05 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-int(2.5 * SR):] *= np.linspace(1, 0, int(2.5 * SR))[:, None]
    return mix


def write_wav(path, mix):
    import wave
    data = (np.clip(mix, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] in STYLES:
        out = sys.argv[2] if len(sys.argv) > 2 else f"drive-mode-{sys.argv[1]}.wav"
        write_wav(out, render(sys.argv[1]))
        print("wrote", out)
    else:
        os.makedirs("samples", exist_ok=True)
        for name in STYLES:
            path = os.path.join("samples", f"drive-mode-{name}.wav")
            write_wav(path, render(name))
            print("wrote", path)
