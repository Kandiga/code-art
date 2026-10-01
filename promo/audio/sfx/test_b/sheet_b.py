#!/usr/bin/env python3
"""contact sheet of spectrogram PNGs (audio/build/tmp/sfx_b/<id>.png): python3 sheet_b.py out.png id1 id2 ... [--cols 2]"""
import sys, os
from PIL import Image, ImageDraw
args = sys.argv[1:]
out = args[0]
cols = 2
ids = []
i = 1
while i < len(args):
    if args[i] == '--cols': cols = int(args[i+1]); i += 2; continue
    ids.append(args[i]); i += 1
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'build', 'tmp', 'sfx_b')
ims = []
for k in ids:
    im = Image.open(os.path.join(d, k + '.png')).convert('RGB')
    ImageDraw.Draw(im).text((70, 6), k, fill=(255, 255, 0))
    ims.append(im)
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (0, 0, 0))
for j, im in enumerate(ims):
    sheet.paste(im, ((j % cols) * w, (j // cols) * h))
sheet.save(out)
print(out, sheet.size)
