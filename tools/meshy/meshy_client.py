"""Minimal Meshy API client for the pet's model pipeline.

The API key is read from C:\\Users\\<you>\\.ds\\meshy.key (or MESHY_API_KEY) and is never
printed, logged, or written anywhere.

    python tools/meshy/meshy_client.py list                 # recent image-to-3d / multi-image tasks
    python tools/meshy/meshy_client.py rig --task <id> --height 1.0 --out <dir>
    python tools/meshy/meshy_client.py rig --model <path.glb> --height 1.0 --out <dir>   # data-URI upload
    python tools/meshy/meshy_client.py status --rig <rig_task_id>
    python tools/meshy/meshy_client.py actions [--search wave]
    python tools/meshy/meshy_client.py animate --rig <rig_task_id> --action <action_id> --out <dir>

Endpoints follow docs.meshy.ai (rigging: /openapi/v1/rigging, animation: /openapi/v1/animations,
image-to-3d list: /openapi/v2/image-to-3d, multi-image list: /openapi/v1/multi-image-to-3d).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.meshy.ai'
KEY_FILE = os.path.join(os.path.expanduser('~'), '.ds', 'meshy.key')


def api_key() -> str:
    key = os.environ.get('MESHY_API_KEY')
    if not key and os.path.exists(KEY_FILE):
        key = open(KEY_FILE, encoding='utf-8').read().strip()
    if not key:
        sys.exit(f'no Meshy API key: put it in {KEY_FILE} or MESHY_API_KEY')
    return key


def call(method: str, path: str, body: dict | None = None, timeout: int = 120) -> dict:
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + api_key())
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode('utf-8')
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:800]
        sys.exit(f'HTTP {e.code} on {method} {path}: {detail}')


def download(url: str, dest: str) -> int:
    os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as r, open(dest, 'wb') as f:
        n = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            n += len(chunk)
    return n


def brief(task: dict) -> str:
    created = task.get('created_at')
    when = time.strftime('%Y-%m-%d %H:%M', time.localtime(created / 1000)) if isinstance(created, (int, float)) else str(created)
    name = task.get('name') or task.get('prompt') or ''
    return f"{task.get('id')}  {task.get('status'):<10} {when}  {task.get('type') or task.get('mode') or ''}  {str(name)[:50]}"


def cmd_list(a):
    for label, path in [('image-to-3d', '/openapi/v1/image-to-3d'), ('multi-image-to-3d', '/openapi/v1/multi-image-to-3d')]:
        q = urllib.parse.urlencode({'page_num': 1, 'page_size': a.n, 'sort_by': '-created_at'})
        res = call('GET', f'{path}?{q}')
        items = res if isinstance(res, list) else res.get('data') or res.get('result') or []
        print(f'== {label}: {len(items)} tasks')
        for t in items:
            print('  ' + brief(t))
            if a.verbose:
                urls = t.get('model_urls') or {}
                print('     model_urls:', {k: (v[:60] + '...') for k, v in urls.items() if isinstance(v, str)})


def wait(path: str, poll_s: float, label: str) -> dict:
    t0 = time.time()
    while True:
        t = call('GET', path)
        st = t.get('status')
        print(f'  {label}: {st} {t.get("progress", "")}%  ({int(time.time() - t0)} s)', file=sys.stderr)
        if st in ('SUCCEEDED', 'FAILED', 'CANCELED'):
            return t
        time.sleep(poll_s)


def cmd_rig(a):
    body: dict = {'height_meters': a.height}
    if a.task:
        body['input_task_id'] = a.task
    elif a.model:
        raw = open(a.model, 'rb').read()
        body['model_url'] = 'data:model/gltf-binary;base64,' + base64.b64encode(raw).decode('ascii')
        print(f'uploading {len(raw) / 1e6:.1f} MB as a data URI', file=sys.stderr)
    else:
        sys.exit('rig needs --task <id> or --model <path.glb>')
    res = call('POST', '/openapi/v1/rigging', body, timeout=900)
    rig_id = res.get('result') or res.get('id')
    print('rig task:', rig_id)
    t = wait(f'/openapi/v1/rigging/{rig_id}', a.poll, 'rig')
    if t.get('status') != 'SUCCEEDED':
        sys.exit(f'rigging {t.get("status")}: {json.dumps(t.get("task_error") or t)[:600]}')
    print('credits consumed:', t.get('consumed_credits'))
    result = t.get('result') or {}
    os.makedirs(a.out, exist_ok=True)
    saved = {}
    for key, name in [('rigged_character_glb_url', 'rigged.glb'), ('rigged_character_fbx_url', 'rigged.fbx')]:
        if result.get(key):
            dest = os.path.join(a.out, f'{a.prefix}_{name}')
            saved[name] = download(result[key], dest)
            print(f'saved {dest} ({saved[name] / 1e6:.1f} MB)')
    for key, name in [('walking_glb_url', 'anim_walking.glb'), ('running_glb_url', 'anim_running.glb'), ('walking_armature_glb_url', 'anim_walking_armature.glb'), ('running_armature_glb_url', 'anim_running_armature.glb')]:
        url = (result.get('basic_animations') or {}).get(key)
        if url:
            dest = os.path.join(a.out, f'{a.prefix}_{name}')
            saved[name] = download(url, dest)
            print(f'saved {dest} ({saved[name] / 1e6:.1f} MB)')
    with open(os.path.join(a.out, f'{a.prefix}_rig_task.json'), 'w', encoding='utf-8') as f:
        json.dump({k: v for k, v in t.items() if k != 'result'} | {'result_keys': sorted(result.keys()), 'saved': saved}, f, indent=2)
    print('rig task id:', rig_id)


def cmd_status(a):
    t = call('GET', f'/openapi/v1/rigging/{a.rig}')
    print(json.dumps({k: v for k, v in t.items() if k != 'result'}, indent=1))
    print('result keys:', sorted((t.get('result') or {}).keys()))


def cmd_actions(a):
    res = call('GET', '/openapi/v1/animations/actions' + (f'?{urllib.parse.urlencode({"page_size": 200})}'))
    items = res if isinstance(res, list) else res.get('data') or res.get('result') or res.get('actions') or []
    for it in items:
        name = str(it.get('name') or it.get('action_name') or '')
        if a.search and a.search.lower() not in name.lower():
            continue
        print(f"{it.get('id') or it.get('action_id')}\t{name}\t{str(it.get('category') or it.get('tags') or '')[:40]}")
    print(f'{len(items)} actions total', file=sys.stderr)


def cmd_animate(a):
    body = {'rig_task_id': a.rig, 'action_id': a.action}
    res = call('POST', '/openapi/v1/animations', body)
    anim_id = res.get('result') or res.get('id')
    print('animation task:', anim_id)
    t = wait(f'/openapi/v1/animations/{anim_id}', a.poll, 'anim')
    if t.get('status') != 'SUCCEEDED':
        sys.exit(f'animation {t.get("status")}: {json.dumps(t.get("task_error") or t)[:600]}')
    result = t.get('result') or {}
    os.makedirs(a.out, exist_ok=True)
    for key, ext in [('animation_glb_url', 'glb'), ('animation_fbx_url', 'fbx'), ('armature_glb_url', 'armature.glb')]:
        if result.get(key):
            dest = os.path.join(a.out, f'{a.prefix}_{a.action}.{ext}')
            n = download(result[key], dest)
            print(f'saved {dest} ({n / 1e6:.1f} MB)')
    print('credits consumed:', t.get('consumed_credits'), '| result keys:', sorted(result.keys()))


def main():
    p = argparse.ArgumentParser(description='Meshy API client (key from ~/.ds/meshy.key, never printed)')
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('list'); s.add_argument('-n', type=int, default=10); s.add_argument('--verbose', action='store_true'); s.set_defaults(fn=cmd_list)
    s = sub.add_parser('rig'); s.add_argument('--task'); s.add_argument('--model'); s.add_argument('--height', type=float, default=1.0)
    s.add_argument('--out', default='spikes/model/generated/meshy'); s.add_argument('--prefix', default='whalechan_meshy'); s.add_argument('--poll', type=float, default=8); s.set_defaults(fn=cmd_rig)
    s = sub.add_parser('status'); s.add_argument('--rig', required=True); s.set_defaults(fn=cmd_status)
    s = sub.add_parser('actions'); s.add_argument('--search'); s.set_defaults(fn=cmd_actions)
    s = sub.add_parser('animate'); s.add_argument('--rig', required=True); s.add_argument('--action', required=True)
    s.add_argument('--out', default='spikes/vrm/anim/meshy'); s.add_argument('--prefix', default='whalechan'); s.add_argument('--poll', type=float, default=8); s.set_defaults(fn=cmd_animate)
    a = p.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
