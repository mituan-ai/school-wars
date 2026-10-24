#!/usr/bin/env python3
# 像素字体子集化：只保留源码里出现过的字符（docs/06 §7）。
# 字体为缝合像素字体 Fusion Pixel Font 12px proportional zh_hans（SIL OFL 1.1，https://github.com/TakWolf/fusion-pixel-font）。
# 用法：python3 tools/subset-font.py <原字体.woff2>   需要 fonttools 与 brotli（pip install fonttools brotli）
import pathlib, re, sys
from fontTools import subset

root = pathlib.Path(__file__).resolve().parent.parent
chars = set(chr(c) for c in range(0x20, 0x7F))
chars |= set('★☆…—–·•→←↑↓×÷±%‰°、。，！？：；（）「」『』《》“”‘’…·＋－＝／＃％＆＠')
for p in list((root / 'src').rglob('*.ts')) + [root / 'index.html']:
    chars |= set(c for c in p.read_text(encoding='utf-8') if ord(c) > 0x7F)
chars = sorted(c for c in chars if not re.match(r'\s', c) or c == ' ')
out = root / 'public' / 'fonts' / 'fusion-pixel-12.woff2'
out.parent.mkdir(parents=True, exist_ok=True)
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
font = subset.load_font(sys.argv[1], opts)
s = subset.Subsetter(opts)
s.populate(text=''.join(chars))
s.subset(font)
subset.save_font(font, str(out), opts)
print(len(chars), 'chars ->', out, out.stat().st_size, 'bytes')
