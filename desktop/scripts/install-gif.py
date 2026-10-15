#!/usr/bin/env python3
"""Склейка кадров установщика в GIF: install-gif.py <каталог с PNG> <выход.gif> <задержка, мс>."""
import glob
import os
import sys

from PIL import Image

src, out, delay = sys.argv[1], sys.argv[2], int(sys.argv[3])
frames = [Image.open(f).convert("RGB") for f in sorted(glob.glob(os.path.join(src, "*.png")))]
# Одна палитра на все кадры — без мерцания цветов между кадрами и меньше размер.
sheet = Image.new("RGB", (frames[0].width, frames[0].height * len(frames)))
for i, f in enumerate(frames):
    sheet.paste(f, (0, i * f.height))
pal = sheet.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
q[0].save(out, save_all=True, append_images=q[1:], duration=delay, loop=0, optimize=True, disposal=1)
print(f"{out}: {len(q)} кадров, {os.path.getsize(out)} байт")
