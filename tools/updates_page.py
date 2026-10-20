"""Builds docs/updates.html from CHANGELOG.md: the newest release open, front
and center, and every one before it (from 1.0 on) in a dropdown underneath.

Run it from the repo root after changing the changelog:

    python tools/updates_page.py
"""
import datetime
import html
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = 'https://github.com/picovrfbt/WispOS'


def inline(text):
    """The changelog's markdown inside a line: **bold**, `code` and [links](url)."""
    out = html.escape(text, quote=False)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', out)

    def link(m):
        url = html.unescape(m.group(2))
        if not re.match(r'^(https://|#|[a-z0-9./-]+$)', url):
            return m.group(1)
        return '<a href="%s">%s</a>' % (html.escape(url), m.group(1))
    return re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, out)


def releases(md):
    """[(version, date, lines)] newest first, from the "## vX.Y.Z (date)" headings."""
    out = []
    for block in re.split(r'^## ', md, flags=re.M)[1:]:
        head, _, body = block.partition('\n')
        m = re.match(r'(v[\d.]+)\s*\(([\d-]+)\)', head.strip())
        if not m:
            continue  # "Unreleased"
        if int(m.group(1)[1:].split('.')[0]) < 1:
            continue  # before 1.0, when Wisp wasn't public yet
        out.append((m.group(1), m.group(2), body.strip('\n').split('\n')))
    return out


def body_html(lines):
    """Paragraphs and lists (a bullet indented two spaces sits under the one above)."""
    out, para, depth = [], [], 0

    def flush():
        if para:
            out.append('<p>%s</p>' % inline(' '.join(para)))
            para.clear()

    def close_to(d):
        nonlocal depth
        while depth > d:
            out.append('</li></ul>')
            depth -= 1

    for line in lines:
        m = re.match(r'^(\s*)[-*] (.*)$', line)
        if m:
            flush()
            d = 2 if len(m.group(1)) >= 2 and depth >= 1 else 1
            if d > depth:
                while depth < d:
                    out.append('<ul>')
                    depth += 1
            else:
                close_to(d)
                out.append('</li>')
            out.append('<li>' + inline(m.group(2)))
        elif not line.strip():
            continue
        else:
            close_to(0)
            para.append(line.strip())
            flush()
    close_to(0)
    return '\n'.join(out)


def nice_date(d):
    return datetime.date.fromisoformat(d).strftime('%B %-d, %Y') if os.name != 'nt' else \
        datetime.date.fromisoformat(d).strftime('%B %#d, %Y')


def page(rels):
    newest, older = rels[0], rels[1:]
    v, d, lines = newest
    short = v.lstrip('v')
    news = 'new/%s.html' % short
    if not os.path.exists(os.path.join(ROOT, 'docs', news)):
        major = '.'.join(short.split('.')[:2])
        news = 'new/%s.html' % major if os.path.exists(os.path.join(ROOT, 'docs', 'new', major + '.html')) else ''
    latest = '''  <article class="upd-latest">
    <div class="upd-head"><span class="tag">Latest</span><span class="upd-date">%s</span></div>
    <h2>Wisp %s</h2>
    <div class="upd-body">
%s
    </div>
    <div class="cta-row">%s<a class="btn" href="%s/releases/tag/%s">Downloads</a></div>
  </article>''' % (nice_date(d), short, body_html(lines),
                   ('<a class="btn primary" href="%s">What\'s new in %s</a>' % (news, short)) if news else '',
                   REPO, v)
    items = []
    for v, d, lines in older:
        intro = next((l for l in lines if l.strip() and not re.match(r'^\s*[-*] ', l)), '')
        items.append('''  <details class="upd-old">
    <summary><span class="upd-v">Wisp %s</span><span class="upd-date">%s</span>%s</summary>
    <div class="upd-body">
%s
    </div>
  </details>''' % (v.lstrip('v'), nice_date(d), ('<span class="upd-sum">%s</span>' % inline(intro)) if intro else '',
                   body_html([l for l in lines if l != intro] if intro else lines)))
    return TEMPLATE.replace('{{LATEST}}', latest).replace('{{OLDER}}', '\n'.join(items)) \
        .replace('{{VER}}', short).replace('{{NEWS}}', news or 'updates.html')


TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wisp updates</title>
<meta name="description" content="Every Wisp update, newest first: what changed in each release of Wisp for the Spotify Car Thing.">
<meta name="theme-color" content="#08080a">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;650;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css">
</head>
<body>
<!-- made by tools/updates_page.py from CHANGELOG.md; edit those, not this -->
<header class="top">
  <div class="wrap">
    <a class="brand" href="./" aria-label="Wisp, home"><img src="logo.svg" alt="">Wisp</a>
    <a class="ver" href="{{NEWS}}" title="What's new in {{VER}}">{{VER}}</a>
    <nav class="links" id="nav-links" aria-label="Main">
      <a href="./#features">Features</a>
      <a href="./#directions">Directions</a>
      <a href="./#addons">Add-ons</a>
      <a href="use.html">How to use</a>
      <a href="guide.html">Set up</a>
      <a href="studio.html">Add-on Studio</a>
      <a href="updates.html" aria-current="page">Updates</a>
    </nav>
    <div class="top-actions">
      <a class="gh" href="https://github.com/picovrfbt/WispOS" aria-label="Wisp on GitHub"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg></a>
      <a class="btn primary dl" href="https://github.com/picovrfbt/WispOS/releases/latest">Download</a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Menu"><span></span></button>
    </div>
  </div>
</header>

<main class="doc updates">
<div class="wrap">
  <p class="eyebrow">Updates</p>
  <h1>What's changed</h1>
  <p class="lead-doc">Wisp's updates come over the air: Settings &rarr; Software update. Here's everything each release brought, newest first.</p>

{{LATEST}}

  <h2 class="upd-earlier">Earlier updates</h2>
{{OLDER}}
</div>
</main>

<footer>
  <div class="wrap">
    <a class="brand" href="./"><img src="logo.svg" alt="">Wisp</a>
    <nav>
      <a href="guide.html">Set up</a>
      <a href="use.html">How to use</a>
      <a href="updates.html" aria-current="page">Updates</a>
      <a href="addons.html">Make an add-on</a>
      <a href="studio.html">Add-on Studio</a>
      <a href="privacy.html">Privacy</a>
      <a href="terms.html">Terms</a>
      <a href="https://github.com/picovrfbt/WispOS">GitHub</a>
      <a href="mailto:support@picovr.store">Contact</a>
    </nav>
    <p class="legal">Wisp is not affiliated with, endorsed by or sponsored by Spotify, Google or YouTube. Spotify and Car Thing are trademarks of Spotify AB.</p>
  </div>
</footer>
<script src="site.js" defer></script>
</body>
</html>
'''

if __name__ == '__main__':
    md = io.open(os.path.join(ROOT, 'CHANGELOG.md'), encoding='utf-8').read()
    out = page(releases(md))
    io.open(os.path.join(ROOT, 'docs', 'updates.html'), 'w', encoding='utf-8', newline='\n').write(out)
    print('docs/updates.html: %d releases' % len(releases(md)))
