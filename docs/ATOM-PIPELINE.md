# 原子资产管线（sand3d）

> 这一页是**动手写之前先读**的一页。它记录 sand3d 的实际语义——大部分是文档没写清、
> 或者和直觉相反的地方。每一条都是踩过坑之后实测出来的。

## 为什么是原子

25 km²、几百栋楼、每个房间的家具都不一样。做成"一个家具 = 一个模型"的话，
资产数量会爆炸到没法维护。

原子化的意思：**资产只到零件级，房间靠摆放数据组装**。

```
房间 = 房间模块（摆放数据） × 原子（零件）
```

- 桌子 = 桌面 + 4 条腿 + 抽屉盒 + 抽屉面 + 把手 + 理线孔 + 脚钉（8 个原子）
- 一本书 = 封面 + 书页 + 书脊（3 个原子）
- 换一个房间 = 换一份摆放数据，原子一个字节都不动

好处：书页可以单独抽出来洒在地上；抽屉可以单独打开；桌面可以单独被砸坏。

## 环境

```powershell
conda create -n sand3d python=3.11 -y --override-channels -c http://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main/
conda run -n sand3d python -m pip install --index-url http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com bpy==4.5.0 sand3d
```

**注意**：本机的 conda 默认走 HTTPS 镜像，会报 `check_hostname requires server_hostname`；
pip 默认的阿里云源是 HTTP，需要带 `--trusted-host`。
`sand3d` 需要 `bpy >= 4.5`，而 `bpy` 只有 Python 3.11 / 3.13 的轮子，所以环境必须是 3.11。

## 命令

```powershell
conda run -n sand3d python assets/programs/build_all.py     # 全量重建 + 刷新清单
conda run -n sand3d python assets/programs/_lib/check_all.py # 尺寸/文件校验（必须过）
npm run dev                                                  # 预览：http://127.0.0.1:5173/atoms.html
```

## 目录

```
assets/programs/
  _lib/
    common.py        材质别名、meta()、export()
    parts.py         可复用的形状（plank / post / tube / panel …）
    check_glb.py     读 GLB 的包围盒（不依赖三方库）
    check_all.py     全库校验：清单尺寸 vs 实际尺寸
    build_manifest.py 汇总成运行时清单
  regions/<region>/<site>/
    desk.py          一个对象的原子集合
    books.py         另一个对象的原子集合
assets/models/<region>/<site>/
  <atom_id>.glb      一个原子一个文件
  <atom_id>.json     原子描述（尺寸、材质、tag、状态）
```

## sand3d 实测语义

这些是文档里没写清、或者和直觉相反的地方。全部经 `_lib/_probe*.py` 量过。

### 坐标与单位

| 事情 | 结论 |
|---|---|
| 程序里的单位 | 毫米（`s3d.units("mm")`） |
| 程序里的轴 | Z 向上 |
| 导出的 GLB | glTF 约定，**Y 向上** |
| 毫米→米的换算 | 放在**节点变换**上（`scale: 0.001`），几何体顶点仍是毫米 |

最后一条是最容易踩的坑：取了几何体而没带上节点变换，一张 1200 mm 的桌子会变成 1200 m。
运行时加载器 `src/render/world/atoms.ts` 会把节点变换烘进几何体，就是因为这个。

### 形状

| 调用 | 结果 |
|---|---|
| `s3d.extrude(name, s3d.rect(w, d), h)` | profile 在 XY，厚度沿 **Z**。`rect` 的 `w` 沿 X，`d` 沿 Y |
| `s3d.box(name, w, d, h)` | X=w, Y=d, Z=h，底面在 Z=0，**居中于 XY 原点** |
| `s3d.cylinder(name, d, h)` | 沿 **Z**，从 Z=0 向上，底面圆心在原点 |
| `s3d.cone(name, d, h, d2=)` | 沿 Z，大端在下 |
| `s3d.revolve(name, profile)` | profile 的 X 是半径、Y 是高度，绕 **Z** 转，实体的高度沿 Z |
| `s3d.shell(solid, t, open=)` | 掏空成壳，`open` 指明开口朝向（`"+Z"` 等） |

### 摆放 `at()`

```python
s3d.at(ob, x=, y=, z=, rx=, ry=, rz=, on=, anchor=)
```

- **旋转单位是度**，不是弧度。
- 变换顺序是 `平移 @ 旋转`（先转再平移）。
- `rx=90` 把 Z 轴转成 Y 轴；`ry=90` 把 Z 轴转成 X 轴。
- `at(ob, on=<frames>)` **会用掉** ob，返回一份副本的列表。必须接住返回值：

  ```python
  posts = s3d.at(post, on=s3d.grid(2, 1, 149))   # posts 是 list[Object]
  ```

- `s3d.grid(nx, ny, px, py)` 以原点为中心，间距 `px`。

### `join` 的陷阱

`join` 是**布尔并集**，融合后保留**第一个对象**的放置变换。被并进来的对象
自己的放置会被叠加到第一个对象的变换上，于是位移被算了两次。

实测：`s3d.join(bar, *posts)` 里 bar 已经 `at(x=80)`，并进来后整体又偏了 160 mm。

**对策**：

- 需要保留各自材质的部分用 `s3d.group()`，不要用 `join`；
- 必须 join 时，让第一个对象的位置就是最终位置；
- 横杆这种"居中在原点"的部件，用 `s3d.box` 而不是 `cylinder` + 旋转——
  `box` 本来就居中，省掉一次旋转也就少一个坑。

### `group` vs `join`

- `group(name, ...)`：一个组，每个零件保留自己的材质，导出时是一个 GLB 里的多个 mesh。
- `join(...)`：一个实体，一个材质。

一个原子 = 一个文件。如果原子内部有两种材质，用 `group`；一种，用 `join`。

## 校验：尺寸必须对得上

`check_all.py` 拿清单里写的 `size_m` 和 GLB 的实际包围盒比对，对不上就失败。
这是唯一的闸门，因为下面三件事都是**静默**的：

- 程序导出时比例错了（1200 mm 的桌子导出成 12 m）；
- 清单和网格对不上（清单说 1.2 m，实际 0.012 m）；
- 原子缺了 GLB，或者文件被改名。

### 轴序

`meta()` 的 `size_m` 按 **sand3d 空间**给（X=宽、Y=深、Z=高），
存进描述文件时转成 **运行时顺序**（X=宽、Y=高、Z=深），正好和 GLB 的 Y-up 包围盒对上。
描述文件里两个都留着：`size_m`（运行时）和 `size_m_s3d`（程序内）。

## 材质

sand3d 只有 21 种预设，没有纸、纸板、泥土。`common.dress()` 做了别名层：

```python
ALIASES = {
    "paper":     ("concrete", 0.90),
    "cardboard": ("concrete", 0.95),
    "soil":      ("concrete", 1.00),
    "cloth":     ("fabric",   0.90),
    ...
}
```

`dress()` 解析别名后再调 `s3d.material`，所以程序里可以直接写 `"paper"`。

## 运行时

```ts
import { buildAtoms, atomsOfRoom } from '@/render/world/atoms';

const instances = RM_JP_06_BEDROOM.placements.map((p) => ({
  id: p.id,
  position: new Vector3(...p.at),
  yaw: p.yaw ?? 0,
}));
await buildAtoms(instances, scene);
```

- 相同 id 的实例合成一个 `InstancedMesh`，一千本书还是一个 draw call。
- 加载器会把几何体归一化：**长边沿 X、底面在 Y=0、水平居中**。
- 房间模块在 `src/render/world/roomModule.ts`，摆放数据是纯数据。

## 预览页

`http://127.0.0.1:5173/atoms.html`

原子化之后最容易出的错是"某个零件浮在空中"或者"某个零件陷进桌面"。
这类问题在渲染图里一眼能看出来，在代码里看不出来。所以每个房间模块都要过一遍预览页。
