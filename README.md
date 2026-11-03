# 尸潮 · 死守 (zombie-hold)

第一人称 3D 据点防守游戏。守住中央发电机,撑过 10 个夜晚;通关后可以继续无尽模式。每局结束结算勋章,在大厅里买局外成长。玩法与设计见 [docs/PLAN.md](docs/PLAN.md)。

## 技术栈

- Vite 8 + TypeScript 5.9
- Vue 3.5(界面:标题、大厅、HUD、建造栏、工坊、卡牌、结算)
- Three.js 0.187(渲染、后期辉光)
- Web Audio 程序合成音效(无音频素材)
- 存档:浏览器 localStorage(跨局存档 `zombie-hold-save-v2`,每个白天的检查点 `zombie-hold-run-v1`;旧的 v1 存档会自动迁移)

游戏逻辑在 `src/game`,不依赖 Three.js / Vue / DOM,可在 Node 中无头运行。

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

调试用的地址参数:`?autostart=1` 直接开一局沙盒(什么都解锁、不存档),`?lobby=1` 直接进大厅,`?training=1` 训练场,`?daily=1` 今天的每日挑战,`?continue=1` 读检查点继续,`?quality=low|mid|high` 临时画质,`?nolock=1` 无头环境假装已锁定鼠标。

## 无头验证脚本

不需要浏览器,直接在 Node 里跑游戏逻辑:

```bash
npm run sim:nav        # 僵尸寻路(环境变量 SIM_SEED 可换随机种子)
npm run sim:combat     # 战斗、弹道、爆头、瞄准
npm run sim:build      # 建造
npm run sim:run        # 一局的流程、胜负、卡牌、机器人试玩
npm run sim:meta       # 局外成长、存档 v2、坏档、检查点确定性
npm run sim:extras     # 爆炸物、手雷、推搡、脉冲、手电、词缀、新僵尸、连杀、挑战、无尽、空投、诅咒牌、首领冲锋、每日挑战
npm run check:balance  # 数值平衡(武器和炮塔)
npm run check:deps     # 模块依赖方向(game 不得依赖 render / ui / three / vue 等)
```

音效自检需要先 `npm run dev`,再运行 `node scripts/tools/audio-check.mjs`(依赖本机 Edge):
把每个音效离线渲染出来,检查有声音、没有 NaN、不爆音。

## 截图脚本(可选,仅开发调试用)

`scripts/tools/shots.mjs` 用 puppeteer-core 驱动本机 Edge 无头截图并收集控制台日志,输出到 `.logs/shots/`。
`--steps 文件.json` 可以按步骤执行(`goto` / `wait` / `eval` / `key` / `click` / `shot`)。
脚本里写死了 Edge 路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
在其他机器上需要修改 `EDGE` 常量。运行游戏本身不需要它。

## 操作

| 按键 | 作用 |
|---|---|
| W A S D | 前后左右移动(相对视线方向) |
| 鼠标 | 转动视角(第一次点击画面锁定鼠标) |
| 左键 | 开火(建造模式下在准星指的格子放置) |
| 右键 | 瞄准(建造模式下拆除) |
| R | 换弹 |
| 1–7 | 切换武器(建造模式下选建筑) |
| Shift | 冲刺 |
| C / Ctrl | 蹲下;冲刺中按 = 滑铲 |
| V | 近战 + 推搡(推开前方的僵尸并硬直,冷却 4 秒) |
| G / B | 扔手雷 / 切换爆炸 · 燃烧 |
| T | 手电筒(电量 12 秒;开着时僵尸更容易发现你) |
| Q | 在发电机旁:电击脉冲(冷却 60 秒) |
| F | 建造模式 |
| E | 靠近工坊时打开工坊(白天);其他时候修理附近建筑 / 发电机 |
| Enter | 白天提前开始夜晚 |
| H | 训练场里开关弹道偏离表 |
| Esc | 释放鼠标并暂停 |

看不到身后时,看右上角的雷达。

## 目录

```
src/app              启动、主循环、界面状态机、输入、事件接线
src/game/core        随机数、数学、事件
src/game/data        武器、僵尸、建筑、波次、卡牌、词缀、难度、局外项目表
src/game/systems     玩家、战斗、建造、一局流程、僵尸 AI、危险物、空投、训练场
src/game/meta        局外成长、开局加成、成就和每日挑战
src/game/save        存档格式和校验、v1 迁移、读写接口、检查点
src/render           Three.js:core(视图、相机、光照、后期)、world、actors、weapons、fx
src/audio            程序合成音效
src/ui               Vue 界面:hud、screens
scripts/sims         无头模拟测试
scripts/tools        截图、音效自检、依赖检查
docs                 设计文档
```
