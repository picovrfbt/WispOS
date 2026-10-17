"""
Packs every add-on folder here into dist/<id>-<version>.zip and writes
catalog.json, the list the Car Thing installs from (with each zip's size and
SHA-256, which the Car Thing checks).

    python pack.py

Every add-on needs a picture (addon.json "image"): a screenshot of it, made
with `node preview.mjs <id>`, or one of your own. It's shown in the catalog
before anyone installs, so it's copied beside the zip with its own checksum.

Run it after adding or changing an add-on, and commit dist/ and catalog.json
with it. The zips are built the same way every time (fixed dates, sorted
names), so an unchanged add-on gives an unchanged zip.
"""

import hashlib
import json
import os
import re
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
# the website's Add-on Studio keeps copies of the templates, the style kit and
# the bridge; they're refreshed from here so they never drift
STUDIO = os.path.join(HERE, "..", "docs", "studio")
SDK = os.path.join(HERE, "..", "wisp-daemon", "daemon", "addon_sdk.js")

ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
PATH = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$")
PERMISSIONS = {"now_playing", "weather", "location", "nav"}
MAX_ZIP = 2 << 20
MAX_FILES = 64
MAX_IMAGE = 200 << 10
IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".webp")


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
    image = m.get("image", "")
    if not image:
        problems.append("image is required: run `node preview.mjs " + folder + "` for a screenshot, or add your own")
    elif not PATH.match(image) or not image.lower().endswith(IMAGE_TYPES):
        problems.append(f"image {image!r} must be a png, jpg or webp in the folder")
    elif not os.path.isfile(os.path.join(HERE, folder, image)):
        problems.append(f"image {image!r} is missing")
    elif os.path.getsize(os.path.join(HERE, folder, image)) > MAX_IMAGE:
        problems.append(f"image {image!r} is over 200 KB")
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
    # the picture, beside the zip, for the catalog to show before installing
    ext = os.path.splitext(m["image"])[1].lower()
    pic = open(os.path.join(HERE, folder, m["image"]), "rb").read()
    pic_name = f"{m['id']}-{m['version']}{ext}"
    with open(os.path.join(DIST, pic_name), "wb") as f:
        f.write(pic)
    entry.update({"image_url": f"dist/{pic_name}", "image_sha256": hashlib.sha256(pic).hexdigest()})
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
    sync_studio()


def sync_studio():
    if not os.path.isdir(STUDIO):
        return
    templates = os.path.join(HERE, "templates")
    shutil.copyfile(os.path.join(templates, "kit.css"), os.path.join(STUDIO, "kit.css"))
    if os.path.isfile(SDK):
        shutil.copyfile(SDK, os.path.join(STUDIO, "sdk.js"))
    out = os.path.join(STUDIO, "templates")
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(templates, out, ignore=shutil.ignore_patterns("kit.css"))
    print("studio: templates, style kit and bridge refreshed")


if __name__ == "__main__":
    main()
