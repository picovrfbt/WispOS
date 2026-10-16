#!/usr/bin/env python3
"""Add a manual "listen now" trigger to mira-voice's oww_wake.c: SIGUSR1 puts the
listener into command capture exactly as if the wake word had been heard."""
import sys

path = sys.argv[1]
s = open(path, encoding="utf-8").read()


def sub(old, new):
    global s
    if old not in s:
        sys.exit(f"patch anchor not found:\n{old}")
    s = s.replace(old, new, 1)


# 1. a second flag, set from a signal handler
sub(
    "static void on_signal(int sig) { (void)sig; g_stop = 1; }\n",
    "static void on_signal(int sig) { (void)sig; g_stop = 1; }\n"
    "\n"
    "// SIGUSR1: capture a command now, as if the wake word had been heard (a button)\n"
    "static volatile sig_atomic_t g_listen = 0;\n"
    "static void on_listen(int sig) { (void)sig; g_listen = 1; }\n",
)

# 2. register it next to the stop signals
sub(
    "\tsignal(SIGTERM, on_signal);\n",
    "\tsignal(SIGTERM, on_signal);\n\tsignal(SIGUSR1, on_listen);\n",
)

# 3. a manual trigger enters RECORDING through the same path as a detection
sub(
    "\t\t\t\tif (score >= threshold && now_s() >= cooldown_until) {\n"
    "\t\t\t\t\tprintf(\"WAKE %.3f\\n\", score);\n",
    "\t\t\t\tint manual = g_listen;\n"
    "\t\t\t\tif (manual || (score >= threshold && now_s() >= cooldown_until)) {\n"
    "\t\t\t\t\tg_listen = 0;\n"
    "\t\t\t\t\tif (manual) printf(\"WAKE manual\\n\");\n"
    "\t\t\t\t\telse printf(\"WAKE %.3f\\n\", score);\n",
)

# 4. a press while already capturing is the same request; don't queue it
sub(
    "\t\t\t} else { // recording\n",
    "\t\t\t} else { // recording\n\t\t\t\tg_listen = 0;\n",
)

# 5. while recording, report how loud the speech is every step (80 ms) as
#    "LEVEL 0.000-1.000": the voice bar on screen moves with it. Scaled from the
#    room's noise floor on a log curve: a quiet room reads ~0, normal speech
#    ~0.5-0.8, a shout 1
sub(
    "\t\t\t\tif (rms > rec_maxrms) rec_maxrms = rms;\n",
    "\t\t\t\tif (rms > rec_maxrms) rec_maxrms = rms;\n"
    "\t\t\t\t{\n"
    "\t\t\t\t\tdouble ratio = rms / (rec_floor > 0 ? rec_floor : EP_FLOOR_MIN);\n"
    "\t\t\t\t\tdouble level = ratio > 1.0 ? log(ratio) / log(40.0) : 0.0;\n"
    "\t\t\t\t\tif (level > 1.0) level = 1.0;\n"
    "\t\t\t\t\tprintf(\"LEVEL %.3f\\n\", level);\n"
    "\t\t\t\t}\n",
)

open(path, "w", encoding="utf-8", newline="\n").write(s)
print("patched", path)
