"""
Suno's stems (up to 12 parts: Drums, Bass, Strings, Keyboard, Lead Vocal...)
folded into the four Drive Mode mixes (drums, bass, other, vocals), ready for
make_drive_assets.py.

    python suno_stems.py <Suno stems .zip> <out folder>

"vocals" is the part the engine treats as the voices on top (the Choir meter):
the sung parts when the song has any, else its lead instruments, so a purely
instrumental song still has something to bring in as you speed up.
"""

import io
import os
import re
import sys
import zipfile

import numpy as np
import soundfile as sf

DRUMS = {"drums", "percussion"}
BASS = {"bass"}
VOICES = {"lead vocal", "lead vocals", "backing vocals", "vocals", "choir"}
# what carries the tune when there's no singing
LEADS = {"synth", "brass", "woodwinds", "lead"}


def part(name):
    # "0 Drums.wav" -> "drums"
    return re.sub(r"^\d+\s*", "", os.path.splitext(os.path.basename(name))[0]).strip().lower()


def main(src, out):
    os.makedirs(out, exist_ok=True)
    parts, rate = {}, None
    with zipfile.ZipFile(src) as z:
        for info in z.infolist():
            if not info.filename.lower().endswith(".wav"):
                continue
            x, r = sf.read(io.BytesIO(z.read(info)), dtype="float32", always_2d=True)
            if x.shape[1] == 1:
                x = np.repeat(x, 2, axis=1)
            rate = rate or r
            assert r == rate, f"{info.filename}: {r} Hz, others {rate} Hz"
            parts[part(info.filename)] = x[:, :2]
    n = max(len(x) for x in parts.values())

    def mix(names):
        acc = np.zeros((n, 2), np.float32)
        for k in names:
            if k in parts:
                acc[: len(parts[k])] += parts[k]
        return acc

    def audible(names):
        return any(k in parts and np.abs(parts[k]).max() > 1e-3 for k in names)

    voices = VOICES if audible(VOICES) else LEADS
    groups = {
        "drums": DRUMS,
        "bass": BASS,
        "vocals": voices,
        "other": set(parts) - DRUMS - BASS - voices,
    }
    for name, members in groups.items():
        sf.write(os.path.join(out, name + ".wav"), mix(members), rate, subtype="PCM_16")
        print(f"{name}: {', '.join(sorted(m for m in members if m in parts)) or '(silent)'}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
