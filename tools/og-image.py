"""
Generates og-image.png, the 1200x630 image shown when a Digital Plumber link is
shared (LinkedIn, Slack, X, iMessage...). Run it again if the branding changes.

Needs Pillow and three open-licence Google Fonts in one folder:
  https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf
  https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf
  https://raw.githubusercontent.com/google/fonts/main/ofl/librefranklin/LibreFranklin%5Bwght%5D.ttf  (save as LibreFranklin.ttf)

Usage (from the repo root):
  python3 tools/og-image.py /path/to/font/folder
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
PAPER, INK, INK2, ACCENT = '#f4efe6', '#1b1814', '#3d372f', '#b8321a'
MARGIN = 80

fonts = sys.argv[1] if len(sys.argv) > 1 else '.'
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'og-image.png')


def franklin(size):
    f = ImageFont.truetype(os.path.join(fonts, 'LibreFranklin.ttf'), size)
    f.set_variation_by_name('SemiBold')
    return f


def spaced(draw, text, font, y, fill, tracking, align='center'):
    """Draws letter-spaced text, centred or left/right aligned within the margins."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = {'center': (W - total) / 2, 'left': MARGIN, 'right': W - MARGIN - total}[align]
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


img = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(img)

# Dateline row: positioning on the left, the address on the right, ruled underneath
label = franklin(18)
spaced(d, 'AI-CURATED INTELLIGENCE FOR PEOPLE WHO RUN NETWORKS', label, 74, INK2, 2.6, 'left')
spaced(d, 'DIGITALPLUMBER.CA', label, 74, ACCENT, 2.6, 'right')
d.rectangle([MARGIN, 110, W - MARGIN, 111], fill=INK)

# Nameplate and tagline
name = ImageFont.truetype(os.path.join(fonts, 'InstrumentSerif-Regular.ttf'), 168)
bbox = d.textbbox((0, 0), 'Digital Plumber', font=name)
d.text(((W - (bbox[2] - bbox[0])) / 2 - bbox[0], 160), 'Digital Plumber', font=name, fill=INK)
tagline = ImageFont.truetype(os.path.join(fonts, 'InstrumentSerif-Italic.ttf'), 50)
bbox = d.textbbox((0, 0), 'Plumbing the information age', font=tagline)
d.text(((W - (bbox[2] - bbox[0])) / 2 - bbox[0], 360), 'Plumbing the information age', font=tagline, fill=INK2)

# Double rule, then what's inside
d.rectangle([MARGIN, 470, W - MARGIN, 472], fill=INK)
d.rectangle([MARGIN, 478, W - MARGIN, 480], fill=INK)
spaced(d, "DAILY BRIEFING  ·  VENDOR RADAR  ·  THE WEEK IN NETWORK INTELLIGENCE", franklin(22), 512, INK2, 2.4)

img.save(out, 'PNG', optimize=True)
print(f'Wrote {os.path.normpath(out)} ({os.path.getsize(out) // 1024} KB)')
