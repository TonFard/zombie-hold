# 上线流程

改完代码、提交之后，两条命令上线：

```
npm run release            # 验证：导出 HEAD → 检查 → 打包 → 启动安装包冒烟。不推送、不发布
npm run release:publish    # 发布：推送 main、打标签、建 GitHub Release、上传安装包、核对
npm run release:republish  # 同版本号已经发过时用：删掉旧发布和旧标签再发
```

先跑 `release` 再跑 `release:publish`：发布时如果上次验证过的构建还对得上 HEAD（提交、版本、文件 sha256 都一致），就直接用它，不重打。没跑过验证直接 `release:publish` 也行，会先走一遍完整流程。

不要写成 `npm run release -- --publish`：在 PowerShell 里 `--` 会被 npm 的脚本吞掉，参数传不过去。要加选项就直接 `node scripts/release.mjs --publish --skip-smoke`。

## 发之前要准备的

1. **提交要发的改动。** 打包的是已提交的 HEAD，工作区里没提交的东西不会进安装包。提交时按文件名 `git add`，别用 `git add -A`：工作区里常有别的没做完的改动。
2. **版本号。** `package.json` 和 `package-lock.json` 的 `version` 要一致，并且已经提交。
3. **发布说明。** 写在 `docs/release-notes/v<版本>.md`，用玩家看得懂的话，写这一版改了什么、有什么要注意的。这个文件就是 GitHub Release 的正文。
4. **GitHub token。** 环境变量 `GH_TOKEN`，或者放在 `%TEMP%\gh_tok.txt`。需要 `repo` 权限。只在 `--publish` 时才会读，不会写进日志。
5. **关掉 Dawn.exe。** 冒烟测试要启动安装包里的游戏，而游戏只允许开一个实例；机器上已经开着一个就会停下来提醒，不会去关你的游戏。

## 流程做了什么

| 步骤 | 做什么 | 为什么这样 |
| --- | --- | --- |
| 预检 | 读版本号、分支必须是 main、发布说明存在；`--publish` 时再查 token 权限、同版本是否已发布 | 问题早暴露，别等打完包才发现 |
| 导出 HEAD | `git archive HEAD` 导出到临时目录，`node_modules` 用链接指回仓库 | 保证包里只有已提交的代码 |
| 检查 | 在导出的 HEAD 上跑 `sim:meta`、`sim:extras`、`sim:stats`、`sim:stars`、`sim:combat`、`check:balance`、`sim:progress` | 测的就是要发的那份，不是工作区 |
| 打包 | `npm run build`（含类型检查）+ `electron-builder`，用本机已装的 electron | 不联网下载 electron（国内下载会卡很久） |
| 冒烟 | 启动打好的 `Dawn.exe`，等主菜单出来，看标题、画布、页面报错 | 包能启动，不是只有源码能跑 |
| 发布 | 推送 `main`（普通快进，不强推）→ 同版本已发过且用了 `--overwrite` 就先删旧发布和旧标签 → 在 HEAD 上打标签 → 建 Release → 上传文件（每个 5 分钟超时，最多重试 3 次） | 上传曾经卡死过一次，必须有超时和重试 |
| 核对 | 远端标签和 `main` 都指向 HEAD、文件齐全且大小一致、`latest` 是这一版 | 不靠"命令没报错"判断成功 |
| 清理 | 摘掉 `node_modules` 链接，再删临时目录 | 先摘链接再删，防止误删仓库的 `node_modules` |

日志在 `.logs/release/`：`release.log` 是总流程，其余是每一步的完整输出。覆盖同版本时，旧发布的信息存在 `.logs/release/old-<标签>.json`。

## 本机试玩包：从工作区直接打（不发布）

`npm run release` 只打已提交的 HEAD。想把还没提交的改动打成桌面版自己玩，手动走这几步（2026-11-15 的 1.2.0 就是这样打的）：

```
NODE_OPTIONS=--max-old-space-size=3072 npx vue-tsc --noEmit      # 类型检查，单独跑（会吃 3 GB 内存）
npx vite build
rm -rf dist/vehicles dist/stims dist/melee                         # 只供本机的素材不进包，见下
npx electron-builder --win -c.electronDist="<仓库>/node_modules/electron/dist"
node .logs/pack/smoke.mjs                                          # 启动 win-unpacked/Dawn.exe 走一遍三个模式
```

- **只供本机的素材**（皮卡 `public/vehicles`、消耗品包 `public/stims`、挥刀动作 `public/melee`）授权不允许分发，安装包里不能有。桌面版改成从 `%APPDATA%\zombie-hold\local-assets\<目录>\` 读（`electron/main.cjs` 的 `LOCAL_DIRS`）：包里没有、那里有就用那里的。这台机器上已经拷过一份；重新导入素材以后要再拷一次。别的机器没有这个目录，游戏走自己的替代品（没有车、消耗品用现成道具染色、自己写的挥刀动作）。
- `node .logs/pack/asarcheck.cjs` 核对包里确实没有这三个目录。
- 这样打出来的包**不要上传**：它包含没提交的代码，和任何一个提交都对不上。
- 桌面版的 CSP 放行了 `wasm-unsafe-eval`：生存世界解码模型要编译 WebAssembly，没有它页面会停在「加载植被……」。

## 玩家数据：更新不清档

更新游戏不能清玩家数据。现在的做法：

- 存档读取是宽松的（`src/game/save/schema.ts` 的 `parseMeta`）：认不出的项目、难度、武器只忽略那一项，级数超过上限按上限算，缺字段补默认值。
- 云端存档不看纪元（`src/app/cloud.ts` 的 `pull`），旧版本传上去的照样读。
- `sim:meta` 里有"版本更新不清进度"的测试，它是发布前检查的一部分。

所以**改存档结构时，在 `parseSave` / `parseMeta` 里兼容旧字段**，不要靠重置。删掉某个局外项目时，旧存档里它的级数会被忽略，勋章不会退，要退的话自己写迁移。

## 覆盖同版本要知道的

`release:republish` 会删掉 GitHub 上这个版本的旧发布和旧标签，旧安装包删了就没了（源码在旧标签指向的提交里，标签位置记在 `old-<标签>.json`）。本地 `release/` 里留着最近打过的包。

## 出问题怎么办

- **检查没通过**：看 `.logs/release/check-<n>.log`，修好、提交，重新跑 `npm run release`。
- **冒烟报"已经开着 Dawn.exe"**：关掉游戏；确实要跳过用 `--skip-smoke`。
- **上传 3 次都失败**：发布已经建好但文件不全。网络恢复后跑 `npm run release:republish`，会复用已验证的构建，只重做发布。
- **推送被拒绝**：`main` 在远端有新提交，先 `git pull --rebase`，再重跑。
- **不要**手动删 `%TEMP%\dawn-release-build` 里的东西：里面的 `node_modules` 是指回仓库的链接，递归删除会连仓库的一起删。流程自己会先摘链接。

## 选项

| 选项 | 作用 |
| --- | --- |
| （无） | 只验证，不发布 |
| `--publish` | 验证后发布；同版本已发过会停下 |
| `--overwrite` | 和 `--publish` 一起用，覆盖同版本 |
| `--rebuild` | 不复用上次的构建 |
| `--skip-checks` | 跳过模拟测试 |
| `--skip-smoke` | 跳过冒烟测试 |
