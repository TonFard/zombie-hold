# 资产树总纲 · Open World Zombie Survival

> 目标：一棵**地区 → 地点 → 房间模块 → 家具装置 → 原子零件**的树，每个叶子是一个独立的、可被单独加载/替换/破坏的资产。
> 上游：地图规划（10 km × 10 km，6 大区）、建筑模块化方案、天气与四季。
> 工具：sand3d（程序化建模，`https://github.com/Sandflow-ai/sand3d`）作为**原子零件生成器**，Blender 做贴图/材质/破坏态，Three.js 做运行时。

---

## 1. 先说结论：sand3d 能提供什么，不能提供什么

### 1.1 它是什么

sand3d **不是模型仓库**，是「用 Python 写程序生成 3D 物体」的库（构建在 Blender 的 `bpy` 上）。它对你这个项目的价值有三层：

| 能力 | 对我们的意义 |
|---|---|
| 原子动词库（`box` `revolve` `extrude` `loft` `sweep` `wire` `shell` `hole` `pocket` `fillet` `chamfer` `dent` `knurl` `thread` `gear` `text`） | 一个零件 = 一段 200–600 token 的程序，**天然原子化**，不会出现"桌面上叠了三个方块当书"这种事 |
| 装配语义（`group` / `assembly` / `attach` / `joint` / `pose`） | 门、抽屉、货架层、轮子可以是**独立的可动节点**，导出的 GLB 把关节写进 `extras` |
| 导出（GLB / URDF / USDA / OBJ / STL） | 直接进 Three.js；URDF/USD 给后续机器人/载具管线留口子 |

它的 `material()` 内置 21 种材质（`oak` `walnut` `birch` `steel` `brushed_steel` `chrome` `aluminium` `brass` `copper` `painted_metal` `plastic` `glossy_plastic` `rubber` `glass` `ceramic` `fabric` `velvet` `leather` `marble` `concrete` `light`）——**几乎正好覆盖末日写实风格**需要的材质族，不用自己从零定义 PBR。

### 1.2 它不能提供什么

- **没有现成模型**。仓库里只有 5 个示例程序（bracket / lamp / rack / chair / gate）和 4 个作品（洗衣机 / 纽扣椅 / 刀叉 / 砝码组）。这些是**代码范例**，不是可下载的 GLB 库。
- Hugging Face 上的 5 个数据集（`sand3d-objaverse` / `sand3d-cad` / `sand3d-articraft` / `sand3d-simready` / `sand3d-automate`，CC BY 4.0）**存的是程序**，不是网格。Objaverse/CAD 的价值在于「教会模型怎么用 sand3d 重建这些物体」，以及当你需要某个特定物体（比如一台真实的机床）时，可以从数据集里挑最接近的程序改写。**不能直接当资产用。**
- 没有 LOD、没有碰撞、没有 UV 展开策略、没有贴图烘焙、没有破坏态。`shell`/`dent`/`cut` 能造结构，但材质和后处理还得靠 Blender。
- **运行环境要求**：Python 3.11 或 3.13 + `bpy`（4.5 LTS / 5.2 LTS）。当前机器是 Python 3.8 且无 `bpy` → **需要单独装一套环境**（推荐 `uv` + `venv`，或直接用 Blender 自带 Python）。

### 1.3 因此我们的分工

```
sand3d 程序  ──►  原子零件 GLB（独立文件，每个 ≤ 2000 tri）
                        │
Blender 后处理 ─────────┤  贴图 / LOD / 碰撞代理 / 破坏变体 / 命名整理
                        │
Three.js 运行时 ◄────────┘  InstancedMesh 复用 + 房间级组装 + 流式加载
```

**结论：sand3d 用在「零件级」最划算**（一把椅子腿、一个罐子、一本书、一根灯管——这些程序短、参数化强、变体多），**房间级和建筑级用现有 blueprints 字符系统 + 手写 Three.js 模块更划算**（因为要跟寻路网格、碰撞盒、地面材质严格对齐）。

---

## 2. 原子化规范（所有叶子资产必须遵守）

### 2.1 什么叫"原子"

一个原子资产 = **一次导出、一个 GLB 文件、一个 Three.js Mesh、可以被单独替换/隐藏/破坏、尺寸与命名符合规范**。

反例（禁止）：
- ❌ 一张"桌子"，桌面上叠三个立方体当书
- ❌ 一个"货架"，上面焊死了饮料罐
- ❌ 一间"卧室"，床和衣柜合并成一个 mesh

正例：
- ✅ `jp_bedroom.desk_top`（桌面）+ `jp_bedroom.desk_leg`（桌腿 ×4，实例化）+ `jp_book.hardcover`（书）+ `jp_book.page_block`（书页块，可单独被撕掉）

### 2.2 尺寸网格

| 类别 | 网格 | 备注 |
|---|---|---|
| 建筑墙 / 地板 / 门洞 | **1.0 m** | 和现有 blueprints 的 1 格 = 1 m 对齐 |
| 室内隔断 | 1.0 m | |
| 家具 | **0.05 m（5 cm）** | 尺寸全是 5 cm 的倍数 |
| 原子零件（小物件） | **0.01 m（1 cm）** | 饮料罐、书、子弹 |
| 楼梯踏步 / 台阶 | 0.175 m | 建筑规范步高 |
| 栏杆 / 扶手 | 0.05 m | |
| 门扇宽度 | 0.05 m | 常用 0.90 / 0.95 / 1.20 |

室内净高：普通房间 **2.7 m**，商业空间 **3.4 m**，工业/仓库 **4.5 m**，教堂/大厅 **7.0 m**。

### 2.3 命名

```
<region>_<site>_<room>_<object>[_<part>][_<variant>]
```

例：
- `jp_konbini_entrance_slidingdoor_leaf_L`
- `jp_bedroom_desk_top_oak`
- `eu_tavern_chair_leg_front`
- `am_gasstation_pump_hose_nozzle`

规则：
- 全小写 + 下划线，无空格无连字符
- 部位顺序固定：`主体 → 大件 → 小件 → 材质变体`
- 变体用后缀：`_oak` `_steel` `_rusted` `_broken` `_a` `_b`

### 2.4 每片叶子资产的元数据

```json
{
  "id": "jp_konbini_shelf_bay_01",
  "region": "jp",
  "site": "konbini",
  "room": "sales_floor",
  "object": "shelf_bay",
  "part": null,
  "style": "japanese",
  "size_m": [0.9, 0.42, 1.65],
  "tri": 1840,
  "origin": "base_center",
  "materials": ["painted_metal"],
  "lod": ["jp_konbini_shelf_bay_01_lod1", "jp_konbini_shelf_bay_01_lod2"],
  "collider": "box",
  "instanced": true,
  "tags": ["interior", "loot_container", "zombie_climbable"],
  "states": ["intact", "bent", "collapsed"]
}
```

**`origin` 统一 `base_center`**：原点在物体底面中心（Z=0 平面，朝上）。这样零件可以在 Three.js 里直接"放在桌面上/货架上"，不需要每个都手调偏移。

### 2.5 材质与贴图

- 所有资产共用一套 **PBR 母材质库**（现在 `props.config.json` 里已有 12 张贴图：asphalt / concrete / dirt / grass / gravel / floor / wall_concrete / wall_brick / wall_plaster / wall_metal / trim_metal / roof / floor_tile）→ 扩展到 **40 张**，按"地区 × 材质"矩阵做，例如 `wall_brick_jp`、`wall_stone_eu`、`wall_siding_am`、`wall_corrugated_industrial`。
- 破损/污渍用**贴花（decal）**，不用进模型（现有 `render/fx/decals.ts` 已有环形缓冲实现）。
- 季节影响用**材质实例 + 顶点色**，不改几何。

### 2.6 LOD 与预算

| 层级 | 预算 | 说明 |
|---|---|---|
| LOD0（< 30 m） | 100% 原始 | 完整细节 |
| LOD1（30–120 m） | 25% | 去掉小零件，保留剪影 |
| LOD2（> 120 m） | 3% | 合并成单 mesh 的剪影块 |
| 远景（> 400 m） | 0 | 只在 `render/world/vista.ts` 里做低模剪影带 |

全局预算（沿用现有 M19 实测：70 僵尸时 641 draw call / 7.9 ms）：
- 单个原子资产 ≤ **2000 tri**（小物件 ≤ 300）
- 一个房间模块（整间）≤ **40k tri**
- 一栋建筑（外壳 + 全部房间）≤ **150k tri**
- 每帧 draw call ≤ **700**

---

## 3. 资产树总览

```
WORLD
│
├─ A. 东京都市区 JP  (3×3 km)
├─ B. 欧式古典城区 EU  (2×2 km)
├─ C. 美式乡镇 AM  (2×2 km)
├─ D. 热带丛林 DL  (2×3 km)
├─ E. 山地荒野 MT  (3×3 km)
└─ F. 过渡带 TR  (区域间的农田/河谷/高速/海岸)
```

每个大区下：**地点（Site）→ 建筑/地貌（Building）→ 房间模块（Room Module）→ 家具装置（Fixture）→ 原子零件（Part）**

### 数量预算

| 层级 | 种类数 | 实例总数（估） |
|---|---|---|
| 地点 Site | 46 | 220 |
| 建筑 / 地貌 Building | 58 | 340 |
| 房间模块 Room | 128 | 1 900 |
| 家具装置 Fixture | 310 | 8 400 |
| **原子零件 Part** | **~940** | 60 000+ |

原子零件 940 个是**种类**数。这是这个项目的核心工作量——比"做 40 栋楼"大一个量级。

---

## 4. 区域 A · 东京都市区（JP）

> 密度最高、丧尸最多、物资最杂。建筑风格关键词：紧凑、窄路、招牌林立、层数高、防灾。

### A.1 地点清单

| ID | 地点 | 建筑数 | 主要建筑 |
|---|---|---|---|
| JP-01 | 商业中心街区 | 12 | 写字楼、综合商场、办公塔、地下商业街 |
| JP-02 | 电器街 / 电子市场 | 4 | 电器店、电子配件楼、二手店 |
| JP-03 | 住宅区 | 16 | 集合住宅（1–8 层）、独栋、公寓 |
| JP-04 | 车站与铁道 | 5 | 站房、月台、地下通道、信号楼、列车 |
| JP-05 | 港岸工业区 | 8 | 仓库、集装箱堆场、工厂、货轮、吊车 |
| JP-06 | 医疗区 | 4 | 综合医院、诊所、药局、动物医院 |
| JP-07 | 学校区 | 3 | 中学、小学、体育馆 |
| JP-08 | 公园与河川 | 4 | 公园、河堤、儿童公园、鸟居 |
| JP-09 | 郊外住宅与农地 | 7 | 独栋、温室、仓库、水田 |
| JP-10 | 地下设施 | 3 | 地下避难所、地铁站、地下车库 |

### A.2 建筑 → 房间 → 家具 → 零件（摘录，全表见 §9 附录）

以 **JP-01 商业中心的「综合商场」** 为例，展示树的完整深度：

```
JP-01-03  综合商场 mall_jp
│
├─ shell_exterior        建筑外壳（不可进入部分）
│  ├─ facade_panel          外墙板
│  ├─ curtain_wall_glass    幕墙玻璃
│  ├─ canopy_roof           雨棚
│  ├─ sign_board_billboard  招牌
│  ├─ awning_fabric         布篷
│  ├─ entrance_steps        台阶
│  └─ rooftop_equipment     屋顶机组（冷却塔、风机）
│
└─ room_*
   ├─ RM-JP-MALL-01  中庭 atrium
   │  ├─ floor_tile_lay
   │  ├─ escalator_balustrade / escalator_step / escalator_handrail
   │  ├─ atrium_glass_roof_frame
   │  ├─ planter_soil / planter_shrub
   │  ├─ kiosk_umbrella / kiosk_counter
   │  └─ directory_sign_board
   │
   ├─ RM-JP-MALL-02  服装区 fashion
   │  ├─ rack_clothing_rail / rack_clothing_hanger
   │  ├─ mannequin_full / mannequin_head / mannequin_stand
   │  ├─ fitting_room_curtain / fitting_room_frame
   │  ├─ display_table / display_table_cloth
   │  ├─ mirror_panel
   │  └─ cash_register / receipt_printer / card_reader
   │
   ├─ RM-JP-MALL-03  食品层 foodcourt
   │  ├─ table_canteen / bench_canteen / tray_canteen
   │  ├─ counter_order / menu_board
   │  ├─ vending_machine / vending_slot / vending_display
   │  └─ kitchen_extract_hood
   │
   ├─ RM-JP-MALL-04  电器层 electronics
   │  ├─ display_case_glass / display_case_base
   │  ├─ tv_panel / tv_stand / tv_remote
   │  ├─ shelf_rack_steel / price_tag_rail / price_tag_card
   │  └─ demo_unit_wallmount
   │
   ├─ RM-JP-MALL-05  卫生间 restroom
   │  ├─ partition_wall / partition_door / partition_latch
   │  ├─ toilet_bowl / toilet_cistern / toilet_seat
   │  ├─ urinal / flush_valve
   │  ├─ washbasin / faucet / soap_dispenser / handdryer
   │  └─ mirror_cabinet
   │
   ├─ RM-JP-MALL-06  员工区 staff
   │  ├─ locker_bench / locker_door / locker_vent
   │  ├─ break_table / break_chair
   │  ├─ time_clock
   │  └─ office_desk / office_chair / monitor / keyboard / mouse
   │
   └─ RM-JP-MALL-07  设备间 plant
      ├─ chiller_unit / chiller_fan / chiller_pipe
      ├─ electrical_panel / breaker_row
      └─ pipe_run / cable_tray
```

---

## 5. 区域 B · 欧式古典城区（EU）

> 关键词：石砌、拱券、窄巷、钟楼、广场、木梁、陡屋顶、教堂。

### B.1 地点清单

| ID | 地点 | 建筑数 |
|---|---|---|
| EU-01 | 老城核心（石砌街巷） | 10 |
| EU-02 | 广场与市政厅 | 6 |
| EU-03 | 教堂区 | 3 |
| EU-04 | 住宅街（联排 + 公寓） | 8 |
| EU-05 | 火车站 | 3 |
| EU-06 | 港口旧仓区 | 4 |
| EU-07 | 市郊酒馆与面包坊 | 7 |
| EU-08 | 城堡与庄园 | 3 |
| EU-09 | 乡村（葡萄园、石墙、农舍） | 8 |

### B.2 建筑清单

| ID | 建筑 | 房间模块 |
|---|---|---|
| EU-B-01 | 教堂 church |  nave / 侧廊 / 祭坛 / 钟塔 / 洗礼堂 / 地下墓室 |
| EU-B-02 | 联排住宅 townhouse |  店铺层 / 起居室 / 卧室×3 / 阁楼 / 地下室 |
| EU-B-03 | 市政厅 townhall |  大厅 / 会议室 / 档案室 / 楼梯厅 / 办公室×4 |
| EU-B-04 | 面包坊 bakery |  展示区 / 烤炉房 / 和面房 / 储藏室 |
| EU-B-05 | 酒馆 tavern |  大堂 / 吧台 / 厨房 / 地窖 / 包间 |
| EU-B-06 | 钟楼 clocktower |  钟室 / 机械房 / 楼梯 / 顶部平台 |
| EU-B-07 | 公寓楼 apartment_eu |  大堂 / 走廊 / 单元×8 / 洗衣房 / 天台 |
| EU-B-08 | 火车站 station_eu |  候车厅 / 售票厅 / 站台 / 行李房 / 站务室 |
| EU-B-09 | 农舍 farmhouse_eu |  厨房 / 起居室 / 畜棚 / 谷仓 / 烘干房 |
| EU-B-10 | 石砌公寓楼 tenement |  门厅 / 水房 / 楼梯 / 房间×6 / 地下室 |
| EU-B-11 | 磨坊 watermill |  磨机室 / 蓄水池 / 粮仓 / 住家 |
| EU-B-12 | 葡萄园酒庄 winery |  发酵间 / 酒窖 / 压榨间 / 品酒室 |
| EU-B-13 | 旧仓库 warehouse_eu |  装卸区 / 货架区 / 办公室 / 阁楼 |
| EU-B-14 | 石桥与水渠 |  桥拱 / 栏杆 / 水闸 |
| EU-B-15 | 墓园 cemetery |  墓碑 / 铁艺围栏 / 石棺 / 小教堂 |

---

## 6. 区域 C · 美式乡镇（AM）

> 关键词：大开间、木壁板、加油站、motel、牧场、公路、pickup truck、信箱。

### C.1 地点清单

| ID | 地点 | 建筑数 |
|---|---|---|
| AM-01 | 镇中心（一条主街） | 9 |
| AM-02 | 郊外住区（独栋 + 拖车房） | 12 |
| AM-03 | 商业带（加油站 / 汽车旅馆 / 快餐） | 8 |
| AM-04 | 学校与警局 | 3 |
| AM-05 | 农场与牧场 | 9 |
| AM-06 | 工业与车站 | 5 |
| AM-07 | 荒野公路与休息区 | 6 |

### C.2 建筑清单

| ID | 建筑 | 房间模块 |
|---|---|---|
| AM-B-01 | 加油站 station_am |  雨棚 / 便利店 / 汽修车间 / 储油罐区 / 卫生间 / 办公室 |
| AM-B-02 | 汽车旅馆 motel |  前台 / 走廊 / 客房×12 / 泳池 / 洗衣房 |
| AM-B-03 | 独栋住宅 house_am |  客厅 / 厨房 / 餐厅 / 主卧 / 卧室×2 / 车库 / 门廊 / 后院 |
| AM-B-04 | 拖车房 trailer |  单间 / 加建走廊 / 台阶 / 雨棚 |
| AM-B-05 | 警局 police_station_am |  大厅 / 值班室 / 拘留室 / 审讯室 / 装备室 / 枪械库 / 办公室×3 |
| AM-B-06 | 中学 school_am |  教室×8 / 走廊 / 办公室 / 体育馆 / 食堂 / 图书馆 / 锅炉房 |
| AM-B-07 | 餐厅 diner |  吧台 / 餐桌 / 厨房 / 备餐间 |
| AM-B-08 | 谷仓 barn |  畜栏 / 干草阁 / 农机区 / 装卸门 |
| AM-B-09 | 牧场围栏 ranch |  围栏段 / 门 / 水槽 / 料槽 / 棚屋 |
| AM-B-10 | 粮仓 / 筒仓 silo |  筒体 / 梯子 / 卸料口 |
| AM-B-11 | 汽车修理厂 garage_am |  工位 / 举升机 / 工具柜 / 零件架 / 办公室 |
| AM-B-12 | 便利店 / 杂货店 general_store |  货架 / 柜台 / 后仓 / 冰柜 |
| AM-B-13 | 休息区 rest_stop |  公厕 / 自动售货机 / 野餐桌 / 垃圾桶 |
| AM-B-14 | 教堂（美式乡村） |  主厅 / 教室 / 地下室 |
| AM-B-15 | 消防站 fire_station |  车库 / 装备间 / 宿舍 / 训练塔 |

---

## 7. 区域 D · 热带丛林（DL）

> 关键词：高湿、大叶植被、藤蔓、栈道、吊桥、瀑布、废弃研究站、营地。

### D.1 地点清单

| ID | 地点 | 建筑数 |
|---|---|---|
| DL-01 | 丛林入口（伐木营地） | 4 |
| DL-02 | 河流与瀑布 | 6 |
| DL-03 | 废弃研究基地 | 5 |
| DL-04 | 高脚屋村 | 6 |
| DL-05 | 洞穴系统 | 4 |
| DL-06 | 橡胶园 / 种植园 | 5 |
| DL-07 | 军事检查站（丛林版） | 3 |

### D.2 建筑 / 地貌清单

| ID | 建筑 / 地貌 | 组件 |
|---|---|---|
| DL-B-01 | 高脚木屋 stilt_house |  桩柱 / 地板梁 / 主体屋 / 走廊 / 楼梯 / 屋顶 / 围栏 |
| DL-B-02 | 研究站模块 lab_module |  走廊 / 实验室 / 宿舍 / 温室 / 发电机房 / 气密门 |
| DL-B-03 | 吊桥 suspension_bridge |  主缆 / 吊索 / 桥面板 / 锚碇 |
| DL-B-04 | 木栈道 boardwalk |  板条 / 边梁 / 支撑桩 / 栏杆 |
| DL-B-05 | 瀑布 waterfall |  跌水面 / 水潭 / 岩石 / 雾 |
| DL-B-06 | 石窟 / 溶洞 |  洞壁 / 钟乳石 / 地面 / 洞口植被 |
| DL-B-07 | 瞭望塔 watchtower |  四柱 / 平台 / 顶棚 / 梯 |
| DL-B-08 | 伐木营地 logging_camp |  棚屋 / 原木堆 / 锯木架 / 卡车残骸 / 火塘 |
| DL-B-09 | 种植园橡胶园 plantation |  橡胶树 / 割胶碗 / 采集篮 / 运输索道 |
| DL-B-10 | 洞穴岩壁 / 悬崖 |  岩层 / 裂缝 / 植被挂垂 |

---

## 8. 区域 E · 山地荒野（MT）+ F 过渡带（TR）

### E.1 地点

| ID | 地点 | 建筑数 |
|---|---|---|
| MT-01 | 针叶林 | 自然 |
| MT-02 | 山区公路 | 自然 + 护栏 + 隧道口 |
| MT-03 | 废弃矿场 | 6 |
| MT-04 | 山地村庄 | 8 |
| MT-05 | 湖泊与露营地 | 5 |
| MT-06 | 军事设施（山中古堡） | 3 |
| MT-07 | 风车 / 瞭望塔 / 输电塔 | 自然 |

### E.2 建筑

| ID | 建筑 | 房间模块 |
|---|---|---|
| MT-B-01 | 矿场主厂房 mine_shed |  选矿区 / 设备间 / 矿工休息室 / 传送带廊 |
| MT-B-02 | 矿井口与竖井 |  井架 / 卷扬机 / 矿车轨道 / 支撑木 |
| MT-B-03 | 山地小屋 cabin |  壁炉间 / 卧铺 / 厨房 / 阁楼 / 门廊 / 柴堆 |
| MT-B-04 | 山地教堂 chapel |  小厅 / 钟室 |
| MT-B-05 | 露营地 campsite |  帐篷 / 营火 / 折叠桌 / 睡袋 / 背包 |
| MT-B-06 | 山中古堡 / 军事指挥所 |  走廊 / 指挥室 / 宿舍 / 武器库 / 瞭望台 |
| MT-B-07 | 隧道 tunnel |  拱顶 / 侧壁 / 轨道 / 通风管 / 应急灯 |
| MT-B-08 | 输电塔 pylon |  塔身 / 横担 / 绝缘子 / 导线 |

### F 过渡带

| ID | 过渡带 | 内容 |
|---|---|---|
| TR-01 | 高速公路 | 路面 / 中央隔离 / 护栏 / 路灯 / 事故现场 / 隧道口 |
| TR-02 | 铁路 | 轨道 / 道砟 / 信号 / 车厢 / 站房 |
| TR-03 | 河谷与桥梁 | 桥面 / 桥墩 / 河床 / 植被 |
| TR-04 | 农田带 | 收割机 / 谷仓 / 灌溉渠 / 稻草人 / 篱笆 |
| TR-05 | 海岸滩涂 | 搁浅船只 / 灯塔 / 栈桥 / 渔具 / 木桩 |
| TR-06 | 城乡结合带 | 汽修 / 废料场 / 加油站 / 广告牌 |

---

## 9. 跨区域通用原子零件库

> 这是**复用率最高**的部分。940 个叶子里大约 **620 个是跨区通用件**，只在材质和变体上区分地区。做成这批，后面所有建筑都便宜。

### 9.1 建筑构件（Shell Kit）— ~120 个

```
SHELL
├─ wall_                     墙体（长条 1m/2m/4m 段，可拼接）
│  ├─ wall_seg_concrete / brick / plaster / wood_siding / stone / corrugated / panel_glass / tile
│  ├─ wall_base_skirting
│  ├─ wall_cornice / wall_pilaster / wall_stringcourse
│  ├─ wall_crack_damage (decal 承载体)
│  └─ wall_rebar_exposed
├─ window_                   窗（框 / 扇 / 玻璃 / 窗台 / 栅栏 / 窗帘）
│  ├─ window_frame_metal / wood / pvc
│  ├─ window_sash_casement / window_sash_sliding / window_sash_shutter
│  ├─ window_glass_pane / window_glass_broken / window_glass_barred
│  ├─ window_sill_stone / window_sill_concrete
│  └─ window_grille_bar
├─ door_                     门（框 / 扇 / 五金）
│  ├─ door_frame_wood / metal / fire
│  ├─ door_leaf_panel / door_leaf_glazed / door_leaf_steel / door_leaf_louver
│  ├─ door_handle_lever / door_handle_knob / door_handle_pushbar
│  ├─ door_hinge / door_latch / door_bolt / door_lock_plate
│  ├─ door_kickplate / door_vision_panel
│  └─ sliding_door_leaf / sliding_door_track / rolling_shutter_door (卷帘门，卷轴 + 帘片)
├─ floor_                    地面
│  ├─ floor_tile / floor_concrete / floor_plank / floor_parquet / floor_tile_pattern / floor_steel_grate
│  ├─ floor_stair_tread / floor_riser
│  └─ floor_threshold_strip
├─ ceiling_                  顶
│  ├─ ceiling_tile_grid / ceiling_tile_panel / ceiling_gypsum
│  ├─ ceiling_industrial_rib / ceiling_truss_steel / ceiling_beam_wood
│  └─ ceiling_light_troffer / ceiling_vent / ceiling_sprinkler / ceiling_demountable
└─ structural_
   ├─ column_concrete / column_steel_ibeam / column_wood_post / column_stone
   ├─ beam_steel / beam_wood / truss_roof
   ├─ balustrade_concrete / balustrade_metal / railing_pipe
   └─ stairs_straight / stairs_l_shaped / stairs_spiral / stair_rail / stair_tread
```

### 9.2 家具与装置（Fixture Kit）— ~210 个

```
FIXTURE
├─ seating_        座椅
│  ├─ chair_dining_wood (腿/座/背/横撑 各为独立零件)
│  ├─ chair_office (坐垫/靠背/气压杆/5爪轮/扶手)
│  ├─ chair_folding / chair_stool / chair_bar_stool
│  ├─ sofa_2seat / sofa_3seat / sofa_loveseat
│  ├─ bench_wood / bench_metal / bench_stone
│  └─ armchair_upholstered / beanbag
├─ tables_         桌
│  ├─ table_dining (桌面/桌腿/围板/横撑)
│  ├─ table_desk (桌面/侧板/抽屉/腿/理线孔)
│  ├─ table_coffee / table_side / table_picnic / table_workshop
│  ├─ table_pool / table_billiard / table_mahjong
│  └─ countertop_shop / countertop_kitchen
├─ storage_        储物
│  ├─ shelf_steel_boltless / shelf_wood / shelf_retail_gondola
│  ├─ shelf_shelf_board / shelf_upright / shelf_price_rail
│  ├─ cabinet_steel / cabinet_wood / cabinet_glass_display / cabinet_locker
│  ├─ cabinet_door / cabinet_drawer / cabinet_drawer_face / cabinet_handle
│  ├─ wardrobe_2door / wardrobe_1door / wardrobe_mirror
│  ├─ drawer_unit_4 / drawer_unit_7 / filing_cabinet
│  ├─ crate_plastic / crate_wood / crate_ammunition
│  ├─ pallet_wood / pallet_painted / bin_trash / bin_rolling
│  └─ container_shipping / container_shelving
├─ bedsleep_       
│  ├─ bed_single (床架/床垫/枕头/被子)
│  ├─ bed_double / bed_bunk / bed_crib / bed_pallet
│  └─ mattress_foam / mattress_spring / pillow / blanket_fold
├─ appliances_     
│  ├─ fridge_upright / fridge_chest_freezer / fridge_display_cooler
│  ├─ stove_gas / stove_electric / oven_built_in / range_hood
│  ├─ microwave / dishwasher / washer_frontload / dryer
│  ├─ aircon_wall / aircon_indoor / fan_ceiling / fan_pedestal
│  ├─ water_heater / boiler / generator_portable
│  └─ vending_machine / atm / arcade_cabinet
├─ lighting_       
│  ├─ light_fixture_pendant / light_fixture_ceiling / light_fluorescent_tube
│  ├─ light_track / light_street / light_floodlight / light_sconce
│  ├─ light_lamp_shade / light_bulb / light_tube / light_emergency
│  ├─ lamp_floor / lamp_table / lamp_desk
│  └─ lantern_hanging / torch_wall
├─ electronics_    
│  ├─ monitor_lcd / tv_flat / crt_tv / radio / radio_walkie
│  ├─ computer_tower / keyboard / mouse / laptop / printer / server_rack
│  ├─ console_game / cable_box / camera_security / camera_cctv
│  └─ antenna / satellite_dish / router
├─ kitchen_        
│  ├─ sink_kitchen / sink_stainless / faucet / faucet_handle
│  ├─ cutting_board / knife_block / pot / pan / kettle
│  ├─ dish_drainer / mug / plate_stack / bowl_stack / glass_tumbler
│  ├─ spice_jar / tin_can_food / pasta_packet / rice_bag
│  └─ cooler_box / thermos / water_barrel
├─ sanitary_       
│  ├─ toilet_bowl / toilet_cistern / toilet_seat / bidet
│  ├─ urinal / washbasin / mirror_cabinet / soap_dispenser
│  ├─ shower_enclosure / shower_head / bathtub / towel_rail
│  └─ toilet_brush / plunger
├─ office_         
│  ├─ office_desk / office_chair / filing_cabinet / conference_table
│  ├─ whiteboard / pinboard / bookcase_wood / bookcase_steel
│  └─ paper_box / pen_cup / stapler / paper_shredder
└─ retail_         
    ├─ checkout_counter / cash_register / card_reader / receipt_printer
    ├─ display_plinth / display_case / mannequin / fitting_room_curtain
    ├─ shopping_basket / shopping_cart / shopping_bag_paper
    ├─ vending_slot / price_tag / poster_panel / shelf_edge_label
    └─ queue_post / turnstile
```

### 9.3 原子小物件（Prop Kit）— ~260 个

> 这是你说的"桌面上的书本一个一个是资产"的那一层。

```
PROP
├─ books_       书籍（可叠放、可散落）
│  ├─ book_hardcover      封面 + 书页块（2 件）
│  ├─ book_paperback
│  ├─ book_magazine
│  ├─ book_manga
│  └─ book_ledger
├─ stationery_  文具
│  ├─ pen_ballpoint / pen_fountain / pencil / marker_highlight
│  ├─ notebook / notepad / envelope / stamp
│  └─ stapler / tape_dispenser / scissors / ruler
├─ containers_  容器
│  ├─ can_soda / can_beer / bottle_pet / bottle_glass / bottle_oil
│  ├─ carton_milk / carton_juice / jar_pickle / jar_jar
│  ├─ bag_chips / pouch_rice / cup_noodle / bento_tray / onigiri_pack
│  ├─ box_cereal / bag_rice / tin_food / bottle_sauce / jar_honey
│  └─ bucket_pail / jug_detergent
├─ food_        
│  ├─ bread_loaf / bun / rice_bowl_pack / sandwich_pack
│  ├─ fruit_apple / fruit_orange / fruit_banana / vegetable_cabbage
│  ├─ can_food_opened / can_food_unopened / cardboard_egg_tray
│  └─ vending_snack / frozen_meal
├─ tools_       
│  ├─ tool_hammer / tool_wrench / tool_screwdriver / tool_pliers
│  ├─ tool_saw_hand / tool_axe / tool_shovel / tool_pickaxe
│  ├─ tool_drill / tool_bolt_cutter / tool_welding_rod
│  └─ toolbox / toolbelt / wrench_set
├─ weapons_     
│  ├─ melee_knife / melee_baseball_bat / melee_crowbar / melee_pipe / melee_sledge
│  ├─ gun_pistol / gun_rifle / gun_shotgun / gun_smg / gun_sniper / gun_lmg / gun_launcher
│  └─ ammo_box / ammo_magazine / ammo_shell / bullet_loose / shell_casing
├─ medical_     
│  ├─ med_bandage / med_gauze / med_splint / med_needle / med_syringe
│  ├─ med_pill_bottle / med_inhaler / med_defib / med_iv_bag
│  ├─ med_antibiotic / med_painkiller / med_antidote / med_firstaid_kit
│  └─ corpse_bag / sanitizer_bottle
├─ electronics_small_
│  ├─ phone_smart / phone_feature / phone_charger / radio_battery / battery_aa
│  ├─ flashlight_body / flashlight_lens / lantern_body / matchbox
│  └─ fuse / cable_coil / tape_roll
├─ misc_household_
│  ├─ bucket / mop / broom / dustpan / spray_bottle
│  ├─ trash_bag / tissue_box / paper_towel / toilet_paper_roll
│  ├─ shoe_pair / slipper / hat_cap / jacket / backpack
│  ├─ glasses_pair / watch_wrist / ring / necklace / wallet
│  ├─ umbrella / bag_grocery / wallet / keyring / key
│  └─ clock_wall / picture_frame / vase / cushion / blanket
├─ natural_     
│  ├─ rock_small / rock_large / log_fallen / branch / stump
│  ├─ mushroom / plant_fern / plant_bush / grass_tuft
│  ├─ flower / moss_patch / vine_hanging / lily
│  └─ bone / skull / shell_seashore
└─ debris_       
    ├─ rubble_pile / concrete_chunk / rebar_piece / broken_glass_cluster
    ├─ cardboard_flat / plank_broken / tile_shard / plastic_shard
    └─ newspaper_pile / leaf_pile / ash_pile / oil_spill
```

### 9.4 车辆 — ~28 个

```
VEHICLE
├─ car_sedan / car_hatch / car_wagon / car_coupe
├─ car_suv / car_pickup / car_van / car_minivan
├─ truck_box / truck_flatbed / truck_tanker / truck_dump
├─ bus_city / bus_school / coach_long
├─ moto_scooter / moto_bike / moto_scooter_3wheel
├─ bicycle_city / bicycle_cargo
├─ tractor_agri / forklift / bulldozer / excavator_arm
├─ boat_fishing / boat_ferry / ship_cargo / yacht_small
└─ emergency_police / emergency_fire / ambulance
```
每个车辆 = 车身外壳 / 玻璃 / 轮胎×4 / 轮毂 / 座椅 / 仪表台 / 方向盘 / 变速杆 / 门把手 / 后视镜 / 保险杠 / 大灯 / 尾灯 / 排气 / 车牌 / 底盘 / 引擎盖 / 行李箱 等 20–35 个零件。

### 9.5 植被与环境 — ~120 个

```
NATURE
├─ tree_       树（按气候分型）
│  ├─ tree_jp_pine / tree_jp_maple / tree_jp_bamboo / tree_jp_cedar
│  ├─ tree_eu_oak / tree_eu_lime / tree_eu_poplar / tree_eu_cypress
│  ├─ tree_am_oak / tree_am_maple / tree_am_pine / tree_am_palm
│  ├─ tree_dl_cecropia / tree_dl_palm / tree_dl_bamboo / tree_dl_strangler_fig
│  ├─ tree_mt_pine / tree_mt_larch / tree_mt_dead
│  └─ tree_dead_bare / tree_stump / tree_root
├─ bush_ / shrub_ / hedge_ / grass_ / fern_ / reed_ / moss_ / algae_
├─ rock_ / boulder_ / cliff_ / scree_ / rubble_
├─ water_      水
│  ├─ water_plane / waterfall / rapids / pool_puddle
│  └─ mud / swamp / ice_patch / snow_patch
└─ ground_     地表
   ├─ ground_asphalt / ground_concrete / ground_dirt / ground_grass / ground_gravel
   ├─ ground_sand / ground_mud / ground_moss / ground_snow / ground_ash
   └─ ground_tile / ground_metal_grate / ground_wood_deck
```

---

## 10. 原子零件的生产管线

```
① 写 sand3d 程序（.py）
   assets/programs/<region>/<site>/<object>.py
   ↓  s3d.export(...)  →  .glb（单位自动转米）
② Blender 后处理（可选，只在需要贴图/破坏态时）
   - 贴图 UV 展开 + 烘焙 AO
   - LOD1/LOD2 生成
   - 碰撞代理（convex / box）
   - 破坏变体导出
   ↓
③ 落盘 assets/models/<region>/<site>/<id>.glb
④ 生成 manifest（TS + JSON）
   assets/manifest/<region>.json
   ↓
⑤ Three.js 加载器（复用现有 props:import 管线）
   src/render/world/props/loader.ts
```

### 10.1 现有工程可以直接复用的

| 现有模块 | 复用点 |
|---|---|
| `scripts/tools/konbini_scene/common.py` | 已有 Blender 工具层：box / cylinder / torus / curve_line / text / decal / 材质工厂 / 贴图烘焙。**新资产直接复用这层** |
| `scripts/tools/konbini_scene/goods.py` | 已有的商品原子件（饮料罐 / 瓶 / 薯片 / 杯面 / 便当 / 饭团 / 杂志 / 购物篮）→ 直接并入 §9.3 `PROP` |
| `src/render/world/props/kit.ts` | Three.js 侧的程序模型工具（box / rbox / cyl / sphere / torus / tube + 材质合并）→ LOD1/LOD2 与小物件的运行时替身 |
| `src/konbini/kit.ts` | 带贴图图集 + 碰撞体登记 + 段标记（可隐藏/可替换）的 Kit → **这就是"原子零件被拾取后消失"的运行时机制**，直接搬到通用加载器 |
| `src/game/world/modules.ts` + `blueprints.ts` | 字符蓝图房间系统 → **房间模块的占位与碰撞层**，比 3D 模型先做，成本极低 |
| `props.config.json` | 资源导入配置 → 扩展成资产 manifest 的来源 |
| `src/render/world/ground-fit.ts` + `check:props` | 贴地校验 → 所有新增模型必须过这个检查 |

### 10.2 必须新建的

```
assets/
├─ programs/            sand3d 程序源（每个原子件一个 .py）
│  ├─ _lib/             通用辅助（materials / profiles / atoms）
│  ├─ shell/            建筑构件
│  ├─ fixture/          家具
│  ├─ prop/             小物件
│  ├─ vehicle/          车辆
│  ├─ nature/           植被
│  └─ regions/          jp / eu / am / dl / mt 各自的特化件
├─ models/<region>/     导出的 GLB
└─ manifest/            资产清单（TS 类型 + JSON）
```

---

## 11. 生产排期（批次）

| 批次 | 内容 | 数量 | 依赖 |
|---|---|---|---|
| **P0** | `_lib` + shell kit（墙/窗/门/地/顶/结构） | ~120 | 三件套工具 |
| **P0** | PROP 通用小物件（9.3 全部） | ~260 | |
| **P0** | FIXTURE 座椅/桌/储物/床 | ~90 | |
| **P1** | JP 区：便利店 + 住宅 + 商业 | ~180 | P0 |
| **P1** | VEHIcle 全套 | ~28 | P0 |
| **P1** | NATURE 全套（先 4 种气候） | ~120 | |
| **P1** | FIXTURE 电器/厨卫/办公/零售 | ~120 | |
| **P2** | EU 区：教堂 + 联排 + 酒馆 + 市政厅 | ~150 | P1 |
| **P2** | AM 区：加油站 + motel + 学校 + 警局 + 农场 | ~160 | P1 |
| **P2** | DL 区：研究站 + 高脚屋 + 吊桥 | ~90 | P1 |
| **P2** | MT 区：矿场 + 山村 + 小屋 | ~110 | P1 |
| **P3** | TR 过渡带 + 载具细分 + 特殊场景（医院/警局/港口） | ~200 | P2 |
| **P4** | 破坏变体集（每个主要资产 2–3 态） | ~180 | P3 |

**总量约 1500 个原子资产**（940 种类 + 破坏变体 + 地区特化件）。

单人（配合 AI 编程）合理速度：**每周 25–40 个**，P0+P1 约 6–8 周，全量约 12–16 周。

---

## 12. 风险

| 风险 | 应对 |
|---|---|
| sand3d 需要 Python 3.11/3.13 + bpy，本机是 3.8 | 单独开 `uv venv --python 3.13` 环境，只用于资产生成，不污染游戏工程 |
| 每个原子件一个 GLB → 文件数爆炸（1500 个） | 按 site 打包成"合批 GLB"（每个 site 一个文件，运行时按材质拆分 + 实例化），同时保留原子粒度（节点名 + extras） |
| 原子化导致 draw call 爆炸 | 严格用 `InstancedMesh`；同材质零件合并（`kit.ts` 的 mergeGeometries 已有） |
| 组合爆炸（每间房都不同） | **房间模块是有限集**：每个 site 最多 6–10 种房间模块，靠随机摆放 + 家具变体 + 材质变体产生"看起来不一样"，底层几何复用 |
| LOD / 碰撞缺失 | LOD2 用 `kit.ts` 程序生成；碰撞用 AABB（现有 `grid.ts` 已够） |
| 美术风格分裂（每区画风不一致） | 强制共用一套 PBR 母材质 + 统一 AO 强度 + 统一污渍叠层；每个资产导出时过 `check:props` |
| 已有 konbini 资产风格独立 | konbini 场景作为 JP-01 的**样板间**保留，其资产编号并入 JP 树，其余建筑向它对齐 |

---

## 13. 下一步

1. **搭 sand3d 环境**（uv venv + bpy），跑通 `bracket` / `lamp` / `rack` 三个官方例子 → 确认导出 GLB 的单位、材质、命名。
2. **定 `_lib`**：把 `konbini_scene/common.py` 的工具层翻译成 sand3d 风格（profile / material / 导出辅助），作为所有程序的公共底座。
3. **先做 30 个**：shell kit 的墙/窗/门/楼梯 + 桌/椅/床/书架 + 书/罐/瓶/工具 各几种，跑通「程序 → GLB → Three.js 实例化 → 室内放置」全链路。
4. **接进现有房间系统**：把 `blueprints.ts` 的字符家具表换成"房间模块 ID + 摆放点"，跑 `sim:nav` 验证可进入性和连通性。

---

## 附录 A · 附录：房间模块清单（128 种）

<details>
<summary>展开</summary>

| ID | 房间 | 适用区域 | 特殊组件 |
|---|---|---|---|
| RM-JP-01 | 便利店销售区 | JP | 冷藏柜、货架、收银台、ATM |
| RM-JP-02 | 便利店库房 | JP | 冷库、纸箱、传送带 |
| RM-JP-03 | 便利店员工间 | JP | 更衣柜、微波炉、休息桌 |
| RM-JP-04 | 集合住宅 1LDK | JP | 榻榻米、押入式壁橱、阳台 |
| RM-JP-05 | 集合住宅 公用走廊 | JP | 信箱阵列、消防栓、告示板 |
| RM-JP-06 | 独栋 日式 | JP | 玄关、榻榻米、障子门、佛龛 |
| RM-JP-07 | 写字楼标准层 | JP | 吊顶、地毯、工位隔断 |
| RM-JP-08 | 写字楼机房 | JP | UPS、精密空调 |
| RM-JP-09 | 商场中庭 | JP | 扶梯、导向牌、植栽 |
| RM-JP-10 | 车站月台 | JP | 屏蔽门、座椅、垃圾桶 |
| RM-JP-11 | 地铁站厅 | JP | 闸机、售票机、线路图 |
| RM-JP-12 | 地铁站台 | JP | 隧道口、应急照明 |
| RM-JP-13 | 港口仓库 | JP | 集装箱、叉车、吊装 |
| RM-JP-14 | 工厂车间 | JP | 机床、流水线、行车 |
| RM-JP-15 | 医院门诊 | JP | 挂号台、候诊椅、叫号屏 |
| RM-JP-16 | 医院病房 | JP | 病床、床头柜、输液架 |
| RM-JP-17 | 医院手术室 | JP | 手术台、无影灯、器械台 |
| RM-JP-18 | 医院药房 | JP | 药柜、发药窗口、冷藏药箱 |
| RM-JP-19 | 学校教室（日） | JP | 讲台、课桌、黑板、吊扇 |
| RM-JP-20 | 学校体育馆 | JP | 篮球架、器械墙、看台 |
| RM-JP-21 | 公园公厕 | JP | 蹲位、洗手台 |
| RM-JP-22 | 地下避难所 | JP | 物资架、发电机、通风管 |
| RM-JP-23 | 便利店后巷 | JP | 垃圾、卷帘门、后门 |
| RM-JP-24 | 居酒屋 | JP | 吧台、格间、灯笼 |
| RM-EU-01 | 教堂中殿 | EU | 长椅、柱列、彩窗 |
| RM-EU-02 | 教堂钟室 | EU | 钟、机械、绳索 |
| RM-EU-03 | 联排店铺层 | EU | 橱窗、柜台、卷帘 |
| RM-EU-04 | 联排住宅 | EU | 壁炉、橡木梁、楼梯 |
| RM-EU-05 | 市政厅大厅 | EU | 大理石地、纪念碑、楼梯 |
| RM-EU-06 | 档案室 | EU | 密集架、卷宗盒 |
| RM-EU-07 | 酒馆大堂 | EU | 长桌、壁炉、吧台 |
| RM-EU-08 | 酒馆地窖 | EU | 木桶、砖拱、桶架 |
| RM-EU-09 | 面包坊 | EU | 烤炉、和面机、面粉袋 |
| RM-EU-10 | 公寓走廊 | EU | 楼梯、信箱、灯 |
| RM-EU-11 | 欧洲公寓单元 | EU | 壁炉、护墙板、阳台 |
| RM-EU-12 | 火车站候车厅 | EU | 木长椅、行李车、钟 |
| RM-EU-13 | 站台 | EU | 铁棚、长石台 |
| RM-EU-14 | 农舍厨房 | EU | 砌灶、长桌、挂锅 |
| RM-EU-15 | 畜棚 | EU | 饲料槽、牲畜栏 |
| RM-EU-16 | 谷仓 | EU | 干草堆、农具、升降机 |
| RM-EU-17 | 磨坊机械间 | EU | 水轮、齿轮、石磨 |
| RM-EU-18 | 酒庄发酵间 | EU | 大桶、压榨机 |
| RM-EU-19 | 墓园小教堂 | EU | 石棺、烛台 |
| RM-EU-20 | 旧仓库 | EU | 木箱、绞盘、阁楼梯 |
| RM-AM-01 | 加油站雨棚下 | AM | 加油机、价目牌、灯箱 |
| RM-AM-02 | 加油站便利店 | AM | 冰柜、咖啡机、彩票架 |
| RM-AM-03 | 汽修车间 | AM | 举升机、工具墙、轮胎堆 |
| RM-AM-04 | 加油站储油区 | AM | 油罐、卸油口、围堰 |
| RM-AM-05 | Motel 前台 | AM | 登记台、钥匙板、告示 |
| RM-AM-06 | Motel 走廊 | AM | 外门、门灯、灭火器 |
| RM-AM-07 | Motel 客房 | AM | 双床、床头柜、电视 |
| RM-AM-08 | Motel 泳池区 | AM | 泳池、躺椅、围栏 |
| RM-AM-09 | 美式客厅 | AM | 沙发、壁炉、电视柜 |
| RM-AM-10 | 美式厨房 | AM | 岛台、双槽冰箱、餐椅 |
| RM-AM-11 | 美式餐厅 | AM | 餐桌、吊灯、餐边柜 |
| RM-AM-12 | 主卧 | AM | 大床、床头柜、梳妆台 |
| RM-AM-13 | 车库 | AM | 工具、举升、车、工作台 |
| RM-AM-14 | 门廊 | AM | 摇椅、秋千、信箱 |
| RM-AM-15 | 警局大厅 | AM | 值班台、公告板、群众座椅 |
| RM-AM-16 | 警局拘留室 | AM | 铁门、混凝土长凳、厕所 |
| RM-AM-17 | 警局枪械库 | AM | 枪架、防弹板、弹药柜 |
| RM-AM-18 | 美式教室 | AM | 单排课桌、白板、储物柜 |
| RM-AM-19 | 体育馆 | AM | 球架、看台、储物间 |
| RM-AM-20 | 美式餐厅（ diner ） | AM | 吧台高脚椅、不锈钢 |
| RM-AM-21 | 谷仓畜栏 | AM | 围栏、饲料槽、干草 |
| RM-AM-22 | 牧场水槽 | AM | 水槽、饮水器、围栏门 |
| RM-AM-23 | 汽车修理厂工位 | AM | 地沟、举升机、零件架 |
| RM-AM-24 | 休息区公厕 | AM | 混凝土洗手台、隔间 |
| RM-DL-01 | 高脚屋内部 | DL | 竹墙、吊床、纱窗 |
| RM-DL-02 | 高脚屋走廊 | DL | 木栏杆、藤编灯 |
| RM-DL-03 | 研究站走廊 | DL | 气密门、管线、应急灯 |
| RM-DL-04 | 实验室 | DL | 通风柜、离心机、样本架 |
| RM-DL-05 | 研究站宿舍 | DL | 双层床、蚊帐、书桌 |
| RM-DL-06 | 温室 | DL | 苗床、灌溉、玻璃顶 |
| RM-DL-07 | 伐木营地棚屋 | DL | 帆布、原木堆、油灯 |
| RM-DL-08 | 洞穴通道 | DL | 岩壁、滴水、火把架 |
| RM-MT-01 | 山地小屋壁炉间 | DL/MT | 石砌炉、柴火、猎枪架 |
| RM-MT-02 | 山地小屋卧铺 | MT | 上下铺、毛毯、油灯 |
| RM-MT-03 | 矿场选矿区 | MT | 溜槽、跳汰机、矿车 |
| RM-MT-04 | 矿工休息室 | MT | 炉子、铁桶床、牌桌 |
| RM-MT-05 | 隧道 | MT | 铁轨、管道、应急灯 |
| RM-MT-06 | 露营地 | MT | 帐篷、营火、折叠椅 |
| RM-MT-07 | 军事指挥室 | MT | 地图桌、无线电、沙盘 |
| RM-MT-08 | 军事宿舍 | MT | 双层床、武器柜 |
| RM-TR-01 | 高速公路事故现场 | TR | 撞毁车、隔离墩、锥桶 |
| RM-TR-02 | 铁路道口 | TR | 道口杆、警示灯、信号 |
| RM-TR-03 | 铁路车厢 | TR | 座椅、行李架、门 |
| RM-TR-04 | 河谷桥头 | TR | 桥墩、护栏、碎石 |
| RM-TR-05 | 农田温室 | TR | 苗床、薄膜、水管 |
| RM-TR-06 | 废料场 | TR | 料堆、传送带、叉车 |
| RM-TR-07 | 海岸码头 | TR | 栈桥、木桩、渔具箱 |
| RM-TR-08 | 灯塔 | TR | 螺旋梯、灯室、透镜 |
| RM-XX-01 | 通用储藏间 | 全部 | 货架、箱、桶 |
| RM-XX-02 | 通用走廊 | 全部 | 门、灯、灭火器、公告板 |
| RM-XX-03 | 通用楼梯间 | 全部 | 扶手、窗、垃圾 |
| RM-XX-04 | 通用卫生间 | 全部 | 隔间、洗手台、镜 |
| RM-XX-05 | 通用地下室 | 全部 | 水管、锅炉、储物 |
| RM-XX-06 | 通用阁楼 | 全部 | 屋梁、储物箱、旧家具 |
| RM-XX-07 | 通用车库/车棚 | 全部 | 工作台、工具、车辆 |
| RM-XX-08 | 通用废墟 | 全部 | 断墙、瓦砾、钢筋 |
| RM-XX-09 | 通用垃圾场 | 全部 | 垃圾堆、废弃车辆、集装箱 |
| RM-XX-10 | 通用地铁通道 | 全部 | 隧道、检修梯、线缆 |

</details>

---

## 附录 B · 附录：现有工程与本树的对应关系

| 现有文件 | 在本树中的位置 |
|---|---|
| `scripts/tools/konbini_scene/*` | `_lib`（工具层）+ JP-01 便利店样板间 |
| `scripts/tools/konbini_scene/goods.py` | PROP → containers / food |
| `src/konbini/kit.ts` | 通用加载器的原子零件运行时机制 |
| `src/render/world/props/*` | FIXTURE / PROP / VEHICLE / NATURE 的运行时替身（程序模型） |
| `src/game/world/blueprints.ts` | RM-XX-* 的占位实现，后续换成真实模块 |
| `props.config.json` | 母材质库 + 外部资源来源 |
| `src/render/world/props.ts` / `realProps.ts` | 资产 manifest 的加载与实例化入口 |
| `docs/KONBINI-POST-OUTBREAK-ASSETS.md` | 第一个 site 的资产规范模板，本文件是它的全图版本 |
