"""
Packs every add-on folder here into dist/<id>-<version>.zip and writes
catalog.json, the list the Car Thing installs from (with each zip's size and
SHA-256, which the Car Thing checks).

    python pack.py

Run it after adding or changing an add-on, and commit dist/ and catalog.json
with it. The zips are built the same way every time (fixed dates, sorted
names), so an unchanged add-on gives an unchanged zip.
"""

import hashlib
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")

ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
PATH = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$")
PERMISSIONS = {"now_playing", "weather", "location", "nav"}
MAX_ZIP = 2 << 20
MAX_FILES = 64


def check(folder, m):
    """the same rules the Car Thing applies (wisp-daemon/daemon/addons.go)"""
    problems = []
    if not ID.match(m.get("id", "")) or m["id"] != folder:
        problems.append("id must be lowercase letters, digits and dashes, and match the folder")
    if not m.get("name") or len(m["name"]) > 40:
        problems.append("name is required, 40 characters at most")
    if len(m.get("description", "")) > 200:
        problems.append("description is 200 characters at most")
    if not m.get("version"):
        problems.append("version is required")
    for p in m.get("permissions", []):
        if p not in PERMISSIONS:
            problems.append(f"permission {p!r} isn't offered")
    for h in m.get("network", []):
        if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", h) or h.endswith(".local"):
            problems.append(f"site {h!r} must be a public host name")
    entry = m.get("entry", "index.html")
    if not PATH.match(entry) or not os.path.isfile(os.path.join(HERE, folder, entry)):
        problems.append(f"entry {entry!r} is missing")
    return problems


def pack(folder):
    files = []
    for root, _, names in os.walk(os.path.join(HERE, folder)):
        for n in names:
            full = os.path.join(root, n)
            rel = os.path.relpath(full, os.path.join(HERE, folder)).replace(os.sep, "/")
            if not PATH.match(rel):
                raise SystemExit(f"{folder}: odd file name {rel!r}")
            files.append((rel, full))
    if len(files) > MAX_FILES:
        raise SystemExit(f"{folder}: more than {MAX_FILES} files")
    m = json.load(open(os.path.join(HERE, folder, "addon.json"), encoding="utf-8"))
    out = os.path.join(DIST, f"{m['id']}-{m['version']}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, full in sorted(files):
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(full, "rb").read())
    data = open(out, "rb").read()
    if len(data) > MAX_ZIP:
        raise SystemExit(f"{folder}: the zip is over 2 MB")
    entry = dict(m)
    entry.update({
        "zip": f"dist/{os.path.basename(out)}",
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    })
    return entry


def main():
    os.makedirs(DIST, exist_ok=True)
    catalog, failed = [], False
    for folder in sorted(os.listdir(HERE)):
        if not os.path.isfile(os.path.join(HERE, folder, "addon.json")):
            continue
        m = json.load(open(os.path.join(HERE, folder, "addon.json"), encoding="utf-8"))
        problems = check(folder, m)
        if problems:
            failed = True
            for p in problems:
                print(f"{folder}: {p}")
            continue
        catalog.append(pack(folder))
    if failed:
        sys.exit(1)
    with open(os.path.join(HERE, "catalog.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"addons": catalog}, f, indent=2)
        f.write("\n")
    for e in catalog:
        print(f"{e['id']} {e['version']}: {e['size']} bytes")


if __name__ == "__main__":
    main()
