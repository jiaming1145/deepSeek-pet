import json, io, os
from PIL import Image

RUN = r'D:/ds/runs/deepseek_humanized_20260830_001'
FINAL = RUN + '/03_parts/revisions/v001/final'
OUT = os.path.dirname(os.path.abspath(__file__))
SCALE = 4  # 4096x8192 -> 1024x2048
CW, CH = 4096 // SCALE, 8192 // SCALE
TAIL = ['tail_root', 'tail_stock', 'tail_fluke_upper', 'tail_fluke_lower']

job = json.load(io.open(RUN + '/04_psd/revisions/v001/packager_job.json', encoding='utf-8'))
layers = [l for l in job['layers'] if l.get('imported')]
layers.sort(key=lambda l: l['z_index'])   # back_to_front

backdrop = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
drawn = skipped_fx = 0
for l in layers:
    name = l['name']
    if name in TAIL:
        continue
    if not l.get('visible', True) or (l.get('default_runtime_opacity') or 0) == 0:
        skipped_fx += 1
        continue
    p = os.path.join(FINAL, name + '.png')
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert('RGBA')
    bb = im.getbbox()
    if not bb:
        continue
    c = im.crop(bb).resize(((bb[2]-bb[0])//SCALE or 1, (bb[3]-bb[1])//SCALE or 1), Image.LANCZOS)
    backdrop.alpha_composite(c, (bb[0]//SCALE, bb[1]//SCALE))
    im.close()
    drawn += 1

bb = backdrop.getbbox()
backdrop.crop(bb).save(os.path.join(OUT, 'parts', 'backdrop.png'))
manifest = {
    'canvas': [CW, CH],
    'scale_from_source': SCALE,
    'backdrop': {'file': 'backdrop.png', 'x': bb[0], 'y': bb[1], 'w': bb[2]-bb[0], 'h': bb[3]-bb[1]},
    'parts': {},
}
print('backdrop: %d layers drawn, %d fx skipped, bbox %s' % (drawn, skipped_fx, bb))

for name in TAIL:
    im = Image.open(os.path.join(FINAL, name + '.png')).convert('RGBA')
    b = im.getbbox()
    c = im.crop(b).resize(((b[2]-b[0])//SCALE, (b[3]-b[1])//SCALE), Image.LANCZOS)
    c.save(os.path.join(OUT, 'parts', name + '.png'))
    manifest['parts'][name] = {'file': name + '.png', 'x': b[0]//SCALE, 'y': b[1]//SCALE,
                               'w': c.size[0], 'h': c.size[1]}
    print('%-18s canvas(%d,%d) %dx%d' % (name, b[0]//SCALE, b[1]//SCALE, c.size[0], c.size[1]))
    im.close()

json.dump(manifest, io.open(os.path.join(OUT, 'parts', 'manifest.json'), 'w', encoding='utf-8'), indent=1)
print('wrote manifest')
