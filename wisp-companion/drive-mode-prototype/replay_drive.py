"""
Replays a real drive (a recording shared from the Wisp app: "Share the last
Drive Mode drive") through the stem mixer, to hear what Drive Mode did on the
road and tune it here.

    python replay_drive.py <drive.csv> <stems folder> [out.wav] [--from S] [--to S]

Prints what the drive was like (speeds, hard brakes, turns, how much of it
was stopped) and writes the music for the stretch asked for (the first five
minutes by default; a whole hour wouldn't fit in memory).
"""

import os
import sys

import numpy as np

import drive_music as dm
import stem_drive
from drive_music import CTRL


def load_drive(path):
    d = np.genfromtxt(path, delimiter=",", names=True)
    return d


def steering(d):
    """the turn as DriveSensors.kt reads it, rebuilt from the raw gyroscope:
    sideways pull (speed x turn rate) through two 0.1 s smoothing stages (a
    weave of the car stays, a phone buzzing in its mount doesn't), a 1 m/s2
    dead zone, full swing at 2.5 m/s2, and nothing for a second after the
    phone itself is moved"""
    t, v, yaw = d["t"], d["speed"] * 0.44704, d["yaw_rate"]
    side = v * yaw
    out = np.zeros_like(t)
    handled_until = -1.0
    s1 = s2 = 0.0
    for i in range(len(t)):
        dt = t[i] - t[i - 1] if i else 0.1
        moved = abs(yaw[i]) > 1.0 or abs(side[i]) > 6.0
        if moved:
            handled_until = t[i] + 1.0
        k = 1 - np.exp(-dt / 0.1)
        s1 += k * ((0.0 if moved else side[i]) - s1)
        s2 += k * (s1 - s2)
        if d["speed"][i] >= 4 and t[i] >= handled_until:
            out[i] = -np.sign(s2) * np.clip((abs(s2) - 1.0) / (2.5 - 1.0), 0, 1)
    return out


def acceleration(d):
    """acceleration as DriveSensors.kt reads it: the GPS trend for the
    direction, the accelerometer for how hard, but never more than a little
    past the trend (a phone shaking in its mount read 0.5 g at a gentle pull)"""
    trend, flat, yaw, v = d["gps_accel"], d["flat_accel"], d["yaw_rate"], d["speed"]
    t = d["t"]
    out = np.zeros_like(t)
    now = 0.0
    for i in range(len(t)):
        dt = t[i] - t[i - 1] if i else 0.1
        a = trend[i]
        if abs(a) > 0.4:
            pull = v[i] * 0.44704 * abs(yaw[i]) * 2.23694
            ahead = np.sqrt(max(flat[i] ** 2 - pull ** 2, 0))
            a = np.sign(a) * min(max(abs(a), ahead), abs(a) * 1.6 + 1.0)
        now += (1 - np.exp(-dt / (0.08 if abs(a) > abs(now) else 0.25))) * (a - now)
        out[i] = now
    return out


def summary(d):
    t, speed, accel, steer = d["t"], d["speed"], acceleration(d), steering(d)
    dur = t[-1] - t[0]
    print(f"drive: {dur / 60:.1f} min, top {speed.max():.0f} mph, "
          f"stopped {100 * np.mean(speed < 1):.0f}% of the time, no GPS {100 * np.mean(d['has_gps'] < 1):.0f}%")
    hard = [k for k in np.nonzero(np.diff((accel < -5.0).astype(int)) > 0)[0]]
    # one per stop, as DriveControls.kt (8 s apart at least)
    kept = []
    for k in hard:
        if not kept or t[k] - t[kept[-1]] >= 8.0:
            kept.append(k)
    hard = kept
    pushes = np.nonzero(np.diff((accel > 3.0).astype(int)) > 0)[0]
    # counted as the music feels them: eased over about half a second, like DriveControls
    eased = np.convolve(steer, np.ones(5) / 5, mode="same")
    turns = np.nonzero(np.diff((np.abs(eased) > 0.5).astype(int)) > 0)[0]
    print(f"hard brakes {len(hard)}, hard pushes {len(pushes)}, turns {len(turns)}")
    print(f"accel range {accel.min():.1f} .. {accel.max():.1f} mph/s; "
          f"clarity mean {d['clarity'].mean():.2f}; drums mean {d['drums'].mean():.2f}")
    for k in hard[:10]:
        print(f"  hard brake at {t[k] - t[0]:.0f} s, {speed[k]:.0f} mph")


def main(argv):
    args = list(argv)
    lo, hi = 0.0, 300.0
    for flag in ("--from", "--to"):
        if flag in args:
            k = args.index(flag)
            v = float(args[k + 1])
            del args[k:k + 2]
            if flag == "--from":
                lo = v
            else:
                hi = v
    csv, stems = args[0], args[1]
    out = args[2] if len(args) > 2 else os.path.join("samples", "drive-replay.wav")
    d = load_drive(csv)
    summary(d)

    t = d["t"] - d["t"][0]
    keep = (t >= lo) & (t <= hi)
    t = t[keep] - lo
    seconds = float(t[-1])
    grid = np.arange(0, seconds, 1 / CTRL)
    # the recording's own speed, acceleration and steering, at the mixer's control rate
    speed = np.interp(grid, t, d["speed"][keep])
    accel = np.interp(grid, t, acceleration(d)[keep])
    steer = np.interp(grid, t, steering(d)[keep])
    dm.simulated_drive = lambda s: (grid, speed, accel, steer)

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    dm.write_wav(out, stem_drive.render(stems, seconds=seconds))
    print("wrote", out, f"({seconds:.0f} s from {lo:.0f} s)")


if __name__ == "__main__":
    main(sys.argv[1:])
