"""
Drive Mode's music for the companion app: one genre's stems, made ready for
the phone's engine (DriveEngine.kt).

  drums.ogg bass.ogg other.ogg vocals.ogg   the track's parts; "other" also
                                            carries a little of the hall
  haze.ogg                                  what's heard stopped: the hall's
                                            dark wash, worked out here because
                                            a 5-second reverb is too much for
                                            a phone to run live (and at 11 kHz,
                                            since it's all below 700 Hz)
  meta.json                                 where the loop runs, the master
                                            level, each part's usual loudness

    python make_drive_assets.py <stems folder> <genre> <song folder>

A genre's songs go in a zip, one folder each (1/, 2/...), released as
wisp-drive-<genre>-vN.zip; the app downloads it the first time the sound is
picked (DriveMusic.kt).
"""

import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve, resample_poly

import drive_music as dm
from drive_music import SR, hp, lp
from stem_drive import STEMS, find_start, load_stem

HAZE_SR = 11025


def write_ogg(path, x, rate, level):
    """in chunks: libsndfile's Vorbis encoder overflows its stack on a long write"""
    with sf.SoundFile(path, "w", rate, x.shape[1], format="OGG", subtype="VORBIS",
                      compression_level=level) as f:
        for i in range(0, len(x), 1 << 15):
            f.write(np.clip(x[i:i + (1 << 15)], -1, 1))


def main(folder, genre, out):
    os.makedirs(out, exist_ok=True)
    stems = {k: load_stem(os.path.join(folder, k + ".wav")) for k in STEMS}
    n = min(len(x) for x in stems.values())
    stems = {k: x[:n] for k, x in stems.items()}

    # the hall, as stem_drive.py has it
    sy = dm.Synth(7)
    irl, irr = dm.reverb_ir(sy, 5.0)
    send = stems["other"] + stems["vocals"] * 0.7 + 0.3 * stems["bass"]
    wet_l = hp(fftconvolve(send[:, 0], irl)[:n], 180, 1)
    wet_r = hp(fftconvolve(send[:, 1], irr)[:n], 180, 1)
    wet = np.stack([wet_l, wet_r], axis=1)
    haze = np.stack([lp(lp(0.25 * send[:, i] + 1.3 * wet[:, i], 700), 700) for i in (0, 1)], axis=1)
    # the engine plays the haze 11 dB down, mostly in the middle
    g_shut = 10 ** (-11 / 20)
    mid, side = (haze[:, 0] + haze[:, 1]) / 2, (haze[:, 0] - haze[:, 1]) / 2 * 0.35
    haze = np.stack([mid + side, mid - side], axis=1) * g_shut
    stems["other"] = stems["other"] + 0.15 * wet

    # the master level: the whole thing at full, levelled as stem_drive.py does
    full = stems["drums"] + stems["bass"] + stems["other"] + stems["vocals"]
    master = 1.0 / (np.percentile(np.abs(full), 99.8) + 1e-9)
    # everything is scaled so the loudest stem fits in 16 bits, the master makes up for it
    peak = max(np.abs(x).max() for x in list(stems.values()) + [haze])
    scale = 0.98 / peak
    master /= scale

    # the loop: from just before the drums come in to before the ending
    start = find_start(stems["drums"], 78.0)
    end = n / SR - 12.0
    meta = dict(
        genre=genre,
        sample_rate=SR,
        haze_rate=HAZE_SR,
        frames=n,
        loop_start=round(start, 2),
        loop_end=round(end, 2),
        crossfade=3.0,
        master=float(master),
        # what one unit of the prototype's mix is in the files (for the brake hit)
        scale=float(scale),
        rms={k: float(np.sqrt(np.mean((x * scale) ** 2))) for k, x in stems.items()},
    )
    for k, x in stems.items():
        write_ogg(os.path.join(out, k + ".ogg"), x * scale, SR, 0.55)
    hz = resample_poly(haze * scale, HAZE_SR, SR, axis=0)
    write_ogg(os.path.join(out, "haze.ogg"), hz, HAZE_SR, 0.7)
    with open(os.path.join(out, "meta.json"), "w", newline="\n") as f:
        json.dump(meta, f, indent=2)
    sizes = {fn: os.path.getsize(os.path.join(out, fn)) // 1024 for fn in sorted(os.listdir(out))}
    print(genre, "loop", meta["loop_start"], "-", meta["loop_end"], "s;", sizes, "KB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
