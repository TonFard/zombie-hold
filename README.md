# 尸潮 · 死守 (zombie-hold)

第一人称 3D 据点防守游戏。守住中央发电机,撑过 10 个夜晚。玩法与设计见 [docs/PLAN.md](docs/PLAN.md)。

## 技术栈

- Vite 8 + TypeScript 5.9
- Vue 3.5(界面:菜单、HUD、建造栏、工坊)
- Three.js 0.187(渲染、后期辉光)
- Web Audio 程序合成音效(无音频素材)
- 存档:浏览器 localStorage

游戏逻辑在 `src/game`,不依赖 Three.js,可在 Node 中无头运行。

## 运行环境

| 项目 | 要求 |
|---|---|
| 操作系统 | 开发在 Windows 10/11 + PowerShell 下进行;macOS / Linux 同样可跑游戏本体 |
| Node.js | 建议 20.19+ 或 22.12+(Vite 8 的要求) |
| 包管理 | npm(仓库带 `package-lock.json`) |
| 浏览器 | 支持 WebGL2 的现代浏览器(Chrome / Edge / Firefox) |
| 显卡 | 需要硬件加速,无 GPU 时会很慢 |

## 快速开始

```bash
npm install
npm run dev        # 开发服务器,默认 http://127.0.0.1:5173
```

其他命令:

```bash
npm run build      # 类型检查 + 生产构建,输出到 dist/
npm run preview    # 预览构建结果
npm run typecheck  # 仅类型检查
```

## 无头验证脚本

不需要浏览器,直接在 Node 里跑游戏逻辑:

```bash
npm run sim:nav        # 僵尸寻路(环境变量 SIM_SEED 可换随机种子)
npm run sim:combat     # 战斗
npm run sim:build      # 建造
npm run sim:run        # 一局的流程、胜负、卡牌、机器人试玩
npm run check:balance  # 数值平衡
```

音效自检需要先 `npm run dev`,再运行 `node scripts/audio-check.mjs`(同样依赖本机 Edge):
把每个音效离线渲染出来,检查有声音、没有 NaN、不爆音。

## 截图脚本(可选,仅开发调试用)

`scripts/shots.mjs` 用 puppeteer-core 驱动本机 Edge 无头截图并收集控制台日志。
脚本里写死了 Edge 路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
在其他机器上需要修改 `EDGE` 常量。运行游戏本身不需要它。

## 操作

| 按键 | 作用 |
|---|---|
| W A S D | 前后左右移动(相对视线方向) |
| 鼠标 | 转动视角(第一次点击画面锁定鼠标) |
| 左键 | 开火(建造模式下在准星指的格子放置) |
| R | 换弹 |
| 1–5 | 切换武器 |
| Shift | 冲刺 |
| B | 建造模式(1/2/3 选建筑,右键或 X 拆除) |
| E | 修理附近建筑 |
| F | 靠近工坊时打开工坊(白天) |
| Enter | 白天提前开始夜晚 |
| Esc | 释放鼠标并暂停 |

看不到身后时,看右上角的雷达。

## 目录

```
src/app        启动与输入
src/game       纯逻辑(核心、系统、数值)
src/render     Three.js 渲染与光照
scripts        模拟、平衡检查、截图脚本
docs           设计文档
```
