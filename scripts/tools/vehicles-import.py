"""
Vettura 车辆 → zombie-hold 开放世界（public/vehicles/<id>/）。
现在只用 Vettura 自带的 T15 皮卡（用户 2026-11-14：只保留皮卡，FJ40 / 765LT / ZX-6R 不用）。

输入：.vendor/vettura（x/ = Vettura 本体 jar 解出来的资源，px/<pack>/ = 官网车包），只读 JSON / PNG / OGG。
输出（每台车一个目录，整个 public/vehicles 不进 git、不进发布包——这些模型没有公开授权，只供本机自己玩）：
  vehicle.json   参数（物理、座椅、方向盘、车门铰链、灯）、骨骼支点、几何体清单
  mesh.bin       所有几何体（位置 f32×3、法线 i16×3 归一化、UV u16×2 归一化、索引 u16/u32）
  <atlas>.webp / <atlas>_n.webp / <atlas>_orm.webp   颜色 / 法线（DirectX 朝向：+G = 图片向下）/ AO-粗糙-金属
  snd/*.ogg      发动机分转速循环、起动、熄火、喇叭
另外 public/vehicles/_common/ 放共用的声音（开关门、碰撞、打滑、风噪），index.json 列出所有车。

坐标：Vettura 模型空间 = 米，+Y 上，车头朝 -Z，+X 是车的右边。骨骼支点在 .geo.json 里是像素（1/16 米），X 取反。
网格顶点相对于骨骼支点。法线：765LT 自带，其他按 crease_angle（默认 50°）算折边平滑法线。

用法：python -I scripts/tools/vehicles-import.py [车 id ...]
"""
import json
import math
import os
import shutil
import struct
import sys

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, '.vendor', 'vettura')
OUT = os.path.join(ROOT, 'public', 'vehicles')
Image.MAX_IMAGE_PIXELS = None

# ---------------------------------------------------------------- 车辆清单
# near = 近处用的网格文件（后缀），far = 远处（LOD2）。atlas: 网格文件后缀 → 贴图名。
T15_PHYS = {
    # T15 的参数写在 Vettura 的 Java 代码里，没有 JSON：按模型量的轴距 / 轮距 / 轮胎，配一台 70 年代小皮卡的数
    'mass': 1650, 'ix': 2500, 'iy': 3100, 'iz': 700, 'comY': 0.7, 'comZ': -0.42,
    'frontZ': -1.6, 'rearZ': 1.25, 'halfTrack': 0.72, 'radius': 0.359,
    'bump': 0.09, 'droop': 0.12, 'springFront': 38000, 'springRear': 42000, 'dampFront': 3000, 'dampRear': 3300,
    'maxSteer': 36, 'antiRollFront': 10000, 'antiRollRear': 5000, 'topSpeed': 145,
    'torqueRpm': [0, 800, 1500, 2200, 2800, 3500, 4200, 4800], 'torqueNm': [150, 170, 192, 205, 200, 186, 165, 140],
    'idleRpm': 700, 'cutRpm': 4800, 'gears': [3.8, 2.3, 1.45, 1.0], 'reverseGear': 4.1, 'finalDrive': 3.9,
    'rolling': 0.016, 'drag': 0.6, 'tank': 70,
}
T15_LAYOUT = {
    'seats': [{'forward': -0.02, 'right': -0.38, 'cushion': 0.74}, {'forward': -0.02, 'right': 0.38, 'cushion': 0.74}],
    'wheelX': -0.37, 'wheelY': 1.125, 'wheelZ': -0.4, 'columnY': -0.6, 'columnZ': -0.8, 'steeringRatio': 17,
    'exitF': -0.2, 'exitR': 1.4,
}
VEHICLES = {
    'pickup_t15': {
        'name': 'T15 皮卡', 'kind': 'car', 'dir': 'x/assets/vettura', 'base': 'pickup_t15', 'def': None,
        'near': ['', '_front'], 'inner': ['_cab', '_seat', '_chassis', '_engine'], 'far': ['_lod2'],
        'wheel': '_wheel', 'wheelFar': '_wheel_lod2',
        'atlas': {'': '', '_front': '', '_lod2': '', '_cab': '_cab', '_seat': '_cab', '_chassis': '_under', '_engine': '_under', '_wheel': '', '_wheel_lod2': ''},
        'paint': {'main': '#6F7556', 'second': '#D8D2C2'},
        'sounds': {'dir': 'pickup_t15', 'on': [[750, 'idle_loop'], [2300, 'mid_loop'], [3900, 'load_loop']], 'off': [[750, 'idle_loop'], [2600, 'coast_loop']],
                   'crank': 'crank_loop', 'start': None, 'stop': 'stop', 'horn': 'horn_loop'},
    },
}
# 贴图边长上限：颜色 / 法线 / ORM
TEX = {'': (2048, 1024, 1024), '_cab': (1024, 512, 512), '_under': (512, 256, 256), '_wheel': (1024, 512, 512)}
# 摩托只有一张 4096 的图（车身 + 轮子 + 仪表都在上面）
TEX_BIKE = (2048, 2048, 1024)
COMMON_SOUNDS = ['door_open', 'door_close', 'crash_heavy', 'crash_light_1', 'crash_light_2', 'crash_light_3', 'skid', 'wind_loop',
                 'tyre_asphalt', 'tyre_dirt', 'tyre_gravel', 'tyre_grass', 'handbrake_pull', 'handbrake_release', 'scrape', 'bottom_out', 'horn_loop']


def load(rel):
    with open(os.path.join(SRC, rel), encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- 材质分类（按零件名）
def lamp_of(name):
    n = name.lower()
    if 'dome' in n or 'dial' in n or 'needle' in n or 'gauge' in n:
        return None
    if 'lamp_reverse' in n:
        return 'reverse'
    if 'lamp_tail' in n or 'glass_tail' in n or 'tail_glass' in n:
        return 'tail'
    if 'lamp_plate' in n or 'lamp_park' in n or ('marker' in n and 'rim' not in n):
        return 'park'
    if ('lamp_low' in n or 'lamp_high' in n or 'glass_lamp' in n or 'glass_head' in n or 'front_lights' in n
            or 'headlight_inside' in n or n.endswith('body_headlight')):
        return 'head'
    return None


def mat_of(part):
    n = part['name'].lower()
    glass = part.get('render_layer') == 'translucent' or 'glass' in n
    if 'paint2' in n:
        cls = 'paint2'
    elif 'paint' in n:
        cls = 'paint'
    else:
        cls = 'base'
    return {'cls': cls, 'glass': glass, 'lamp': lamp_of(n)}


def mat_key(m):
    return f"{m['cls']}|{int(m['glass'])}|{m['lamp'] or ''}"


# ---------------------------------------------------------------- 法线
def crease_normals(P, F, crease_deg):
    """P[V,3] 位置，F[n,3] 三角形 → 每个角的法线 [n,3,3]。同一位置、夹角小于 crease 的面一起平滑（按面积加权）"""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    fn = np.cross(b - a, c - a)
    ln = np.linalg.norm(fn, axis=1, keepdims=True)
    fu = fn / np.maximum(ln, 1e-12)
    n = len(F)
    corner_v = F.reshape(-1)
    corner_f = np.repeat(np.arange(n), 3)
    q = np.round(P / 1e-4).astype(np.int64)
    _, key = np.unique(q, axis=0, return_inverse=True)
    key = key.reshape(-1)
    g = key[corner_v]
    order = np.argsort(g, kind='stable')
    gs = g[order]
    starts = np.flatnonzero(np.r_[True, gs[1:] != gs[:-1]])
    sizes = np.diff(np.r_[starts, len(gs)])
    # 每个角和同组所有角配对
    size_of = np.repeat(sizes, sizes)
    start_of = np.repeat(starts, sizes)
    ii = np.repeat(np.arange(len(gs)), size_of)
    off = np.arange(len(ii)) - np.repeat(np.cumsum(size_of) - size_of, size_of)
    jj = np.repeat(start_of, size_of) + off
    ci = order[ii]
    cj = order[jj]
    fi = corner_f[ci]
    fj = corner_f[cj]
    cosc = math.cos(math.radians(crease_deg))
    ok = (fu[fi] * fu[fj]).sum(1) >= cosc - 1e-6
    out = np.zeros((len(corner_v), 3))
    for k in range(3):
        out[:, k] = np.bincount(ci[ok], weights=fn[fj[ok], k], minlength=len(corner_v))
    ln2 = np.linalg.norm(out, axis=1, keepdims=True)
    out = np.where(ln2 > 1e-12, out / np.maximum(ln2, 1e-12), fu[corner_f])
    return out.reshape(n, 3, 3)


def triangulate(faces):
    tris = []
    for f in faces:
        for k in range(1, len(f) - 1):
            tris.append((f[0], f[k], f[k + 1]))
    return np.asarray(tris, dtype=np.int64).reshape(-1, 3)


def part_geometry(part, crease):
    V = np.asarray(part['vertices'], dtype=np.float64)
    P = V[:, :3]
    UV = V[:, 3:5]
    F = triangulate(part['faces'])
    if len(F) == 0:
        return None
    if part.get('normals') is not None and len(part['normals']) == len(V):
        N = np.asarray(part['normals'], dtype=np.float64)
        N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
        return P, N, UV, F
    cn = crease_normals(P, F, part.get('crease_angle', crease))
    # 角 → (顶点, 量化法线) 去重成新顶点
    cv = F.reshape(-1)
    cnq = np.round(cn.reshape(-1, 3) * 512).astype(np.int64)
    rows = np.concatenate([cv[:, None], cnq], axis=1)
    uniq, first, inv = np.unique(rows, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    nv = cn.reshape(-1, 3)[first]
    return P[uniq[:, 0]], nv, UV[uniq[:, 0]], inv.reshape(-1, 3)


# ---------------------------------------------------------------- 输出缓冲
class Bin:
    def __init__(self):
        self.parts = []
        self.size = 0

    def add(self, arr):
        b = arr.tobytes()
        off = self.size
        self.parts.append(b)
        self.size += len(b)
        pad = (-self.size) % 4
        if pad:
            self.parts.append(b'\0' * pad)
            self.size += pad
        return off

    def write(self, path):
        with open(path, 'wb') as f:
            for p in self.parts:
                f.write(p)


def pack_geometry(binf, P, N, UV, F):
    pos = P.astype(np.float32)
    nrm = np.clip(np.round(N * 32767), -32767, 32767).astype(np.int16)
    uv = np.clip(np.round(UV * 65535), 0, 65535).astype(np.uint16)
    idx = F.reshape(-1).astype(np.uint16 if len(P) < 65536 else np.uint32)
    return {
        'count': int(len(P)),
        'index': int(len(idx)),
        'big': bool(len(P) >= 65536),
        'pos': binf.add(pos),
        'nrm': binf.add(nrm),
        'uv': binf.add(uv),
        'idx': binf.add(idx),
        'min': [round(float(x), 4) for x in P.min(0)],
        'max': [round(float(x), 4) for x in P.max(0)],
    }


def bone_pivots(geo_path):
    g = load(geo_path)['minecraft:geometry'][0]
    out = {}
    for b in g.get('bones', []):
        p = b.get('pivot') or [0, 0, 0]
        out[b['name']] = [round(-p[0] / 16, 5), round(p[1] / 16, 5), round(p[2] / 16, 5)]
    return out


def mesh_file(spec, suffix):
    return f"{spec['dir']}/meshes/{spec['base']}{suffix}.vxmesh.json", f"{spec['dir']}/geo/{spec['base']}{suffix}.geo.json"


def build_meshes(spec, suffixes, binf, bones, geoms, role, tex_alpha):
    """把这些网格文件的零件按（骨骼, 材质, 贴图）合并 → geoms 里加条目，返回索引列表"""
    groups = {}
    for suf in suffixes:
        mp, gp = mesh_file(spec, suf)
        m = load(mp)
        for name, piv in bone_pivots(gp).items():
            bones.setdefault(name, piv)
        crease = m.get('crease_angle', 50)
        atlas = spec['atlas'][suf]
        for part in m['parts']:
            g = part_geometry(part, crease)
            if g is None:
                continue
            mat = mat_of(part)
            k = (part.get('bone', 'body'), atlas, mat_key(mat))
            e = groups.setdefault(k, {'mat': mat, 'P': [], 'N': [], 'UV': [], 'F': [], 'n': 0, 'names': []})
            P, N, UV, F = g
            e['P'].append(P)
            e['N'].append(N)
            e['UV'].append(UV)
            e['F'].append(F + e['n'])
            e['n'] += len(P)
            e['names'].append(part['name'])
    out = []
    for (bone, atlas, _), e in sorted(groups.items()):
        P = np.concatenate(e['P'])
        N = np.concatenate(e['N'])
        UV = np.concatenate(e['UV'])
        F = np.concatenate(e['F'])
        entry = pack_geometry(binf, P, N, UV, F)
        entry.update({'role': role, 'bone': bone, 'atlas': atlas, 'mat': dict(e['mat'])})
        if e['mat']['glass']:
            # 玻璃的不透明度：顶点 UV 处颜色贴图 alpha 的平均（贴图没给 alpha 就用 0.35）
            a = tex_alpha.get(atlas)
            if a is not None:
                h, w = a.shape
                px = np.clip((UV[:, 0] * w).astype(int), 0, w - 1)
                py = np.clip((UV[:, 1] * h).astype(int), 0, h - 1)
                op = float(a[py, px].mean()) / 255
                entry['mat']['opacity'] = round(op if op < 0.97 else 0.35, 3)
            else:
                entry['mat']['opacity'] = 0.35
        geoms.append(entry)
        out.append(len(geoms) - 1)
    return out


# ---------------------------------------------------------------- 贴图
def resize(im, size):
    if im.size[0] <= size:
        return im
    return im.resize((size, size), Image.LANCZOS)


def normal_convention(n_img):
    """LabPBR 法线的 G 方向：用 alpha 里的高度图对一下（+ = 图片向下 / DirectX）"""
    a = np.asarray(n_img, dtype=np.float32)
    if a.shape[2] < 4:
        return None
    h = a[:, :, 3]
    if h.std() < 1:
        return None
    gy = np.gradient(h, axis=0)
    gx = np.gradient(h, axis=1)
    g = a[:, :, 1] - 127.5
    r = a[:, :, 0] - 127.5
    m = (np.abs(gy) + np.abs(gx)) > 2
    if m.sum() < 1000:
        return None
    cg = float(np.corrcoef(g[m], gy[m])[0, 1])
    cr = float(np.corrcoef(r[m], gx[m])[0, 1])
    return cg, cr


def export_atlas(spec, atlas, out_dir, sizes, report):
    base = f"{spec['dir']}/textures/entity/vehicle/{spec['base']}{atlas}"
    name = atlas.lstrip('_') or 'main'
    sb, sn, so = sizes
    col = Image.open(os.path.join(SRC, base + '.png')).convert('RGBA')
    alpha = np.asarray(col)[:, :, 3]
    has_alpha = alpha.min() < 250
    c = resize(col, sb)
    if not has_alpha:
        c = c.convert('RGB')
    c.save(os.path.join(out_dir, f'{name}.webp'), 'WEBP', quality=88, method=5)
    files = {'base': f'{name}.webp'}
    npath = os.path.join(SRC, base + '_n.png')
    spath = os.path.join(SRC, base + '_s.png')
    flip = False
    if os.path.exists(npath):
        nim = Image.open(npath).convert('RGBA')
        conv = normal_convention(resize(nim, 1024))
        # 高度梯度和 G 正相关 = OpenGL（+G 朝图片上方）→ 翻成 DirectX
        flip = conv is not None and conv[0] > 0.05
        report.append(f'{spec["base"]}{atlas}_n: corr(G, dh/dy)={conv[0]:+.2f} corr(R, dh/dx)={conv[1]:+.2f} → {"OpenGL, flip G" if flip else "DirectX"}' if conv else f'{spec["base"]}{atlas}_n: no height, assume DirectX')
        n = np.asarray(resize(nim, sn), dtype=np.float32) / 255
        x = n[:, :, 0] * 2 - 1
        y = n[:, :, 1] * 2 - 1
        flat = (n[:, :, 0] == 0) & (n[:, :, 1] == 0)
        x[flat] = 0
        y[flat] = 0
        if flip:
            y = -y
        z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
        rgb = np.stack([x * 0.5 + 0.5, y * 0.5 + 0.5, z * 0.5 + 0.5], axis=2)
        Image.fromarray(np.clip(rgb * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(out_dir, f'{name}_n.webp'), 'WEBP', quality=92, method=5)
        files['normal'] = f'{name}_n.webp'
        ao = np.asarray(resize(nim, so), dtype=np.uint8)[:, :, 2]
        ao = np.where((ao == 0), 255, ao)
    else:
        ao = None
    if os.path.exists(spath):
        s = np.asarray(resize(Image.open(spath).convert('RGBA'), so), dtype=np.uint8)
        # 粗糙度最低 0.25：车漆 / 镀铬原本 0.09~0.12，近乎镜面，太阳的高光在这个游戏的 bloom 里会整片发光
        metal = np.where(s[:, :, 1] >= 230, 255, 0).astype(np.uint8)
        # 金属（镀铬保险杠）再粗一点：金属反射太阳比车漆强得多
        rough = np.maximum(255 - s[:, :, 0].astype(np.int32), np.where(metal > 0, 97, 64)).astype(np.uint8)
        if ao is None:
            ao = np.full_like(rough, 255)
        orm = np.stack([ao, rough, metal], axis=2)
        Image.fromarray(orm, 'RGB').save(os.path.join(out_dir, f'{name}_orm.webp'), 'WEBP', quality=90, method=5)
        files['orm'] = f'{name}_orm.webp'
        emit = s[:, :, 3]
        files['emissive'] = bool((emit < 255).mean() > 0.0005)
    return files, alpha


# ---------------------------------------------------------------- 一台车
def norm_layout(spec, d):
    lay = (d or {}).get('layout') or T15_LAYOUT
    phys = dict((d or {}).get('physics') or T15_PHYS)
    phys.pop('hull', None)
    seats = []
    for s in lay.get('seats', []):
        seats.append({k: s[k] for k in ('forward', 'right', 'cushion', 'scale', 'eyeLift', 'eyeForward', 'yaw') if k in s})
    out = {
        'seats': seats,
        'cabCushion': lay.get('cabCushion', 0.74),
        'steer': {'x': lay.get('wheelX', 0), 'y': lay.get('wheelY', 1), 'z': lay.get('wheelZ', 0),
                  'ay': lay.get('columnY', -0.6), 'az': lay.get('columnZ', -0.8), 'ratio': lay.get('steeringRatio', 16)},
        'exitF': lay.get('exitF', -0.2), 'exitR': lay.get('exitR', 1.4),
        'lampLow': lay.get('lampLow'), 'lampTail': lay.get('lampTail'),
        'exhaust': lay.get('exhaust'),
        'hingeX': lay.get('hingeX'), 'hingeY': lay.get('hingeY'), 'hingeZ': lay.get('hingeZ'),
        'doorAxis': lay.get('doorAxis'), 'doorAngle': lay.get('doorAngle'),
        'barGrip': lay.get('barGrip'),
        'engineRear': lay.get('engineRear', False),
    }
    return phys, out


def sound_table(spec, d, out_dir):
    sd = os.path.join(out_dir, 'snd')
    os.makedirs(sd, exist_ok=True)
    if spec.get('sounds'):
        s = spec['sounds']
        src = os.path.join(SRC, 'x/assets/vettura/sounds', s['dir'])
        used = set()

        def cp(n):
            if not n:
                return None
            shutil.copyfile(os.path.join(src, n + '.ogg'), os.path.join(sd, n + '.ogg'))
            used.add(n)
            return f'snd/{n}.ogg'
        return {'on': [[r, cp(n)] for r, n in s['on']], 'off': [[r, cp(n)] for r, n in s['off']],
                'crank': cp(s['crank']), 'start': cp(s['start']), 'stop': cp(s['stop']), 'horn': cp(s['horn'])}
    sj = load(f"{spec['dir']}/sounds.json")
    ns = spec['dir'].split('/')[-1]

    def res(ev):
        if not ev:
            return None
        key = ev.split(':', 1)[1]
        e = sj.get(key)
        if not e:
            return None
        nm = e['sounds'][0]
        nm = nm['name'] if isinstance(nm, dict) else nm
        rel = nm.split(':', 1)[1]
        srcf = os.path.join(SRC, spec['dir'], 'sounds', rel + '.ogg')
        dst = rel.replace('/', '_') + '.ogg'
        shutil.copyfile(srcf, os.path.join(sd, dst))
        return f'snd/{dst}'
    eng = d.get('engine', {})
    lad = eng.get('ladder', {})
    snd = d.get('sounds', {})
    assert ns
    return {'on': [[r, res(n)] for r, n in lad.get('on', [])], 'off': [[r, res(n)] for r, n in lad.get('off', [])],
            'crank': res(eng.get('crank')), 'start': res(eng.get('start')), 'stop': res(eng.get('stop')), 'horn': res(snd.get('horn'))}


def wheels_of(kind, phys):
    r = phys['radius']
    if kind == 'bike':
        return [{'x': 0, 'z': phys['frontZ'], 'steer': True, 'drive': False, 'geo': 'front', 'side': 0},
                {'x': 0, 'z': phys['rearZ'], 'steer': False, 'drive': True, 'geo': 'rear', 'side': 0}]
    t = phys['halfTrack']
    awd = phys.get('allWheel', False)
    out = []
    for z, front in ((phys['frontZ'], True), (phys['rearZ'], False)):
        for side in (-1, 1):
            out.append({'x': side * t, 'z': z, 'steer': front, 'drive': (not front) or awd, 'geo': 'wheel', 'side': side, 'r': r})
    return out


def convert(vid):
    spec = VEHICLES[vid]
    print(f'== {vid}', flush=True)
    out_dir = os.path.join(OUT, vid)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    d = load(spec['def']) if spec['def'] else None
    phys, layout = norm_layout(spec, d)
    report = []
    atlases = {}
    alphas = {}
    for atlas in sorted(set(spec['atlas'].values())):
        sizes = TEX_BIKE if spec['kind'] == 'bike' else TEX[atlas]
        files, alpha = export_atlas(spec, atlas, out_dir, sizes, report)
        atlases[atlas or 'main'] = files
        alphas[atlas] = alpha
    binf = Bin()
    bones = {}
    geoms = []
    near = build_meshes(spec, spec['near'], binf, bones, geoms, 'near', alphas)
    inner = build_meshes(spec, spec['inner'], binf, bones, geoms, 'inner', alphas)
    far = build_meshes(spec, spec['far'], binf, bones, geoms, 'far', alphas)
    wbones = {}
    wnear = build_meshes(spec, [spec['wheel']], binf, wbones, geoms, 'wheel', alphas)
    wfar = build_meshes(spec, [spec['wheelFar']], binf, wbones, geoms, 'wheelFar', alphas)
    binf.write(os.path.join(out_dir, 'mesh.bin'))
    # 外壳：近处车身网格（不含门这些活动件）的包围盒
    lo = np.array([1e9] * 3)
    hi = np.array([-1e9] * 3)
    for i in near:
        g = geoms[i]
        if g['bone'] in ('body',) and not g['mat']['glass']:
            lo = np.minimum(lo, g['min'])
            hi = np.maximum(hi, g['max'])
    paints = (d or {}).get('paints') or []
    paint = spec.get('paint')
    if not paint:
        paint = next((p for p in paints if p['id'] == spec.get('paintId')), paints[0] if paints else {'main': '#888888'})
    sounds = sound_table(spec, d, out_dir)
    for k, v in atlases.items():
        for kk in ('base', 'normal', 'orm'):
            if kk in v:
                v[kk] = v[kk]
    out = {
        'id': vid, 'name': spec['name'], 'kind': spec['kind'],
        'phys': phys, 'layout': layout, 'bones': bones,
        'wheels': wheels_of(spec['kind'], phys),
        'geoms': geoms, 'near': near, 'inner': inner, 'far': far, 'wheel': wnear, 'wheelFar': wfar,
        'atlases': atlases,
        'paint': {'main': paint.get('main', '#888888'), 'second': paint.get('second', paint.get('main', '#888888'))},
        'hull': {'min': [round(float(x), 3) for x in lo], 'max': [round(float(x), 3) for x in hi]},
        'sounds': sounds,
        'source': 'Vettura (Antaurora) — local only, not for redistribution',
    }
    with open(os.path.join(out_dir, 'vehicle.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    tris = lambda ids: sum(geoms[i]['index'] for i in ids) // 3
    print(f'   near {len(near)} geoms {tris(near)} tris · inner {len(inner)} geoms {tris(inner)} tris · far {len(far)} geoms {tris(far)} tris · wheel {tris(wnear)} / {tris(wfar)} tris · bin {binf.size / 1048576:.1f} MB')
    print(f'   hull {out["hull"]} · bones {list(bones)}')
    for r in report:
        print('   ' + r)
    return {'id': vid, 'name': spec['name'], 'kind': spec['kind']}


def main():
    ids = sys.argv[1:] or list(VEHICLES)
    os.makedirs(OUT, exist_ok=True)
    cm = os.path.join(OUT, '_common')
    os.makedirs(cm, exist_ok=True)
    for n in COMMON_SOUNDS:
        p = os.path.join(SRC, 'x/assets/vettura/sounds/pickup_t15', n + '.ogg')
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(cm, n + '.ogg'))
    done = [convert(v) for v in ids]
    idx_path = os.path.join(OUT, 'index.json')
    prev = []
    if os.path.exists(idx_path) and sys.argv[1:]:
        with open(idx_path, encoding='utf-8') as f:
            prev = [p for p in json.load(f)['vehicles'] if p['id'] not in ids]
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump({'vehicles': prev + done, 'common': sorted(n for n in COMMON_SOUNDS if os.path.exists(os.path.join(cm, n + '.ogg')))}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'README.txt'), 'w', encoding='utf-8') as f:
        f.write('Converted from Vettura (Antaurora) vehicle packs for local play only.\n'
                'No public licence: do not commit, do not ship in releases. Rebuild: python -I scripts/tools/vehicles-import.py\n')


if __name__ == '__main__':
    main()
