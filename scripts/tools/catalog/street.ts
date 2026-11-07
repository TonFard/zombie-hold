// 街道、车辆、周边建筑、底座：street.ts / traffic.ts / buildings.ts / ground.ts。
import type { AssetEntry } from './types';

const S = (category: string) => (a: Omit<AssetEntry, 'category' | 'status'>): AssetEntry => ({ category, status: 'pending', ...a });
const st = S('street');
const nb = S('neighbor');
const vh = S('vehicle');

export function street(): AssetEntry[] {
  return [
    st({ id: 'street_lamp', name: '路灯', dims: [0.3, 5.6, 1.78], budget: 800, count: 3, origin: 'custom', source: 'street.ts:41', notes: '原点在灯杆底部，灯臂伸向 +Z。杆 #8a9098（r0.07→0.09，高 5.2），底套，弯臂，灯头 #6a6e76；灯罩单独节点 lamp_glow（#fff2d0 发光）。', interactions: [
      { id: 'switch', label: '路灯开关', type: 'visibility', nodes: ['lamp_glow'], note: '游戏里：同时关掉对应的聚光灯；第 2 盏会接触不良闪烁' },
    ] }),
    st({ id: 'utility_pole', name: '电线杆', dims: [1.6, 8.2, 0.36], budget: 2000, count: 6, source: 'street.ts:99', notes: '水泥杆 #9a9a98，下半截黄黑防撞套 5 节，两根横担（1.6 / 1.2 m）+ 绝缘子，蓝色街区编号牌，8 根脚钉。', interactions: [] }),
    st({ id: 'pole_transformer', name: '杆上变压器', dims: [0.64, 0.96, 0.64], budget: 400, count: 1, source: 'street.ts:116', notes: '#8a9098 圆桶 + 顶帽；补一个抱箍连到杆上。', interactions: [] }),
    st({ id: 'power_wire', name: '电线（一档）', dims: [16.0, 0.78, 0.03], budget: 300, count: 20, source: 'street.ts:133', notes: '下垂的悬链，#1a1a1e。档距 5–16 m 不等，游戏里按档距缩放，或者直接在场景里用曲线生成。', interactions: [] }),
    st({ id: 'traffic_signal_pole', name: '车用信号灯杆（L 形双臂）', dims: [4.12, 5.8, 4.32], budget: 600, count: 1, origin: 'custom', source: 'street.ts:166', notes: '原点在杆底。杆 + 两根 5.4 m 高的方臂（一根往 +Z 4.2 m，一根往 +X 4.0 m）。灯头另列。', interactions: [] }),
    st({ id: 'traffic_signal_head', name: '车用信号灯头（横式三灯）', dims: [1.2, 0.44, 0.39], budget: 600, count: 2, source: 'street.ts:175', notes: '灯箱 #5a6068 + 三个遮光帽；三个灯片分开做节点 lamp_green / lamp_yellow / lamp_red（左→右），亮的时候换成自发光色。', interactions: [
      { id: 'cycle', label: '红绿灯切换', type: 'state', nodes: ['lamp_green', 'lamp_yellow', 'lamp_red'], note: '游戏里：36 秒一个循环（绿 14 → 黄 3 → 红…），灯片换颜色，不是换模型。这里每点一下切到下一个灯' },
    ] }),
    st({ id: 'ped_signal', name: '行人信号灯（含按钮盒）', dims: [0.34, 3.0, 0.31], budget: 600, count: 2, source: 'street.ts:202', notes: '杆 + 灯箱（上红 ped_red、下绿 ped_green 两个灯片节点）+ 黄色按钮盒（红色按钮节点 push_button）。', interactions: [
      { id: 'button', label: '按过街按钮', type: 'code', nodes: ['push_button'], note: '游戏里：哔一声，「おまちください」，绿灯提前到 3 秒内' },
      { id: 'lights', label: '红灯 / 绿灯', type: 'state', nodes: ['ped_red', 'ped_green'], note: '游戏里：车道 B 绿灯时行人绿灯，最后 4 秒闪烁' },
    ] }),
    st({ id: 'road_sign', name: '路牌', dims: [0.6, 3.0, 0.1], budget: 300, count: 4, source: 'street.ts:288', notes: '立柱 #9aa0a8 + 牌面（只贴正面）+ 背板。牌底高度：横断步道 / 限速 2.4，P 2.0，地名 2.7。', variantLabel: '款式', variants: [
      { id: 'crossing', name: '横断步道', status: 'pending' },
      { id: 'parking', name: 'P 停车场', status: 'pending' },
      { id: 'placename', name: '地名牌（1.4 × 0.58）', status: 'pending' },
      { id: 'speed', name: '限速', status: 'pending' },
    ], interactions: [] }),
    st({ id: 'pipe_rail', name: '白色管栏（一跨）', dims: [1.8, 0.85, 0.07], budget: 200, count: 38, source: 'street.ts:303', notes: '立柱 r0.035 + 两根横管（0.45 / 0.82 m），#e8e8e4。跨长 1.6–2.2 m，游戏里沿 X 缩放。', interactions: [] }),
    st({ id: 'bollard', name: '黄色防撞柱', dims: [0.17, 0.8, 0.17], budget: 150, count: 4, source: 'street.ts:321', notes: '#f0c030，0.55 m 处一圈黑环。', interactions: [] }),
    st({ id: 'notice_board', name: '町内会公告栏', dims: [1.7, 1.92, 0.3], budget: 400, count: 1, source: 'street.ts:332', notes: '两根木腿 #5a4030，绿色板 #3a6a4a，小雨檐，4 张告示（图集 notice0..3：夏まつり / 防犯 / 迷いねこ / ゴミ出し）。', interactions: [
      { id: 'read', label: '看公告', type: 'code', note: '游戏里：显示四张告示的内容' },
    ] }),
    st({ id: 'beer_crate', name: '啤酒箱（含 4 个空瓶）', dims: [0.45, 0.31, 0.35], budget: 300, count: 5, source: 'street.ts:355', notes: '塑料格箱 + 4 个棕色空瓶 #6a3a1a。', variantLabel: '款式', variants: [{ id: 'red', name: '红', color: '#d8402a', status: 'pending' }, { id: 'yellow', name: '黄', color: '#d8a020', status: 'pending' }], interactions: [] }),
    st({ id: 'potted_plant', name: '盆栽', dims: [0.48, 0.71, 0.48], budget: 600, count: 3, source: 'street.ts:364', notes: '陶盆 #b8603a + 叶团。场景里按 0.8 / 1.0 / 1.2 缩放。', interactions: [] }),
    st({ id: 'ac_wall_unit', name: '小巷空调室外机', dims: [0.8, 0.6, 0.35], budget: 300, count: 2, source: 'street.ts:375', notes: '#e4e4e0，正面风扇。', interactions: [] }),
    st({ id: 'gas_meter', name: '煤气表 + 竖管', dims: [0.51, 3.2, 0.2], budget: 200, count: 1, source: 'street.ts:381', notes: '表 0.2 × 0.3 × 0.15，离地 1.2；竖管 r0.03 高 3.2，补一段连接管。', interactions: [] }),
    st({ id: 'alley_lantern', name: '小巷红灯笼', dims: [0.38, 0.6, 0.38], budget: 300, count: 1, source: 'street.ts:384', notes: '红色灯身（发光 #d8302a）+ 上下黑圈；补一个吊钩。', interactions: [] }),
    st({ id: 'white_cat', name: '小白猫 + 纸箱', dims: [0.52, 0.73, 0.42], budget: 3000, count: 1, source: 'street.ts:391', notes: '纸箱 #b8905a + 蹲坐的白猫 #f4f4f0（绿眼睛 #3ab05a，尾巴）。猫是节点 cat，可以做骨骼。', interactions: [
      { id: 'meow', label: '摸摸小白猫', type: 'trigger', clip: 'meow', nodes: ['cat'], note: '游戏里：「にゃあ」…是公告栏上走丢的小白（しろ）' },
      { id: 'idle', label: '待机呼吸', type: 'loop', clip: 'idle', nodes: ['cat'], note: '游戏里：一直轻轻摇摆' },
    ] }),
    vh({ id: 'car_sedan', name: '轿车', dims: [1.74, 1.42, 4.02], budget: 6000, count: 2, source: 'traffic.ts:24', notes: '车头 +Z。车身、车厢、车窗（#223040）、前挡风、前后保险杠、4 个轮子（节点 wheel_fl / wheel_fr / wheel_rl / wheel_rr，可以转）、前灯（发光 #fff8e0）、尾灯（发光 #ff2a20）。注意：现在的程序模型车轮偏到一边、前挡风倾斜方向反了，按正常车做。', variantLabel: '款式', variants: [{ id: 'white', name: '白', color: '#e8e8e4', status: 'pending' }, { id: 'red', name: '暗红', color: '#8a2a2a', status: 'pending' }], interactions: [
      { id: 'honk', label: '按喇叭', type: 'code', note: '游戏里：车可见时按 E，喇叭响' },
    ] }),
    vh({ id: 'car_taxi', name: '出租车', dims: [1.74, 1.6, 4.02], budget: 6000, count: 1, source: 'traffic.ts:48', notes: '同轿车车身，藏青 #2a3a5a + 金色腰线 #d8a020 + 车顶行灯（发光 #fff0a0）。', interactions: [
      { id: 'honk', label: '按喇叭', type: 'code', note: '游戏里：喇叭响' },
    ] }),
    nb({ id: 'window_unit', name: '楼房窗户', dims: [1.2, 1.4, 0.12], budget: 100, count: 72, source: 'buildings.ts:107', notes: '窗台 #c8c8c4 + 窗框 #6a6e76 + 窗面（图集 win0..5，亮的发光）。亮窗面单独节点 window_lit。场景里尺寸从 0.9 × 1.45 到 1.35 × 1.2 不等（缩放）。', interactions: [
      { id: 'light', label: '开灯 / 关灯', type: 'visibility', nodes: ['window_lit'], note: '游戏里：每 6–16 秒随机一扇窗开关灯' },
    ] }),
    nb({ id: 'apartment', name: '3 层公寓「メゾン夜川」', dims: [9.0, 11.5, 23.1], budget: 12000, count: 1, source: 'buildings.ts:142', notes: '正面（外走廊）在世界里朝 +X，做的时候朝 +Z。主体 #d8c8b0，层高 2.9；外走廊 + 栏板 + 扶手，每层 5 扇门（5 种颜色）+ 门灯 + 小窗，洗衣机，室外钢楼梯 10 级；南面入口雨棚、信箱（图集 mailbox）、楼名牌（图集 aptName）；屋顶水箱。窗户用 window_unit。', interactions: [] }),
    nb({ id: 'old_house', name: '两层老房子（瓦顶）', dims: [17.2, 6.8, 5.6], budget: 8000, count: 1, source: 'buildings.ts:198', notes: '主体 #b8a890，人字瓦顶 #3a4458（坡度约 25°）+ 瓦线 + 屋脊；后门 + 门檐、换气扇。现在的程序模型屋顶做反了（V 形），按正常人字顶做。', interactions: [] }),
    nb({ id: 'cage_cart', name: '后院垃圾笼车', dims: [2.0, 1.2, 1.0], budget: 1500, count: 1, source: 'buildings.ts:224', notes: '镂空金属笼车 #8a9098，里面绿色垃圾袋。', interactions: [] }),
    nb({ id: 'cardboard_stack', name: '折叠纸箱垛', dims: [1.02, 0.16, 0.8], budget: 100, count: 1, source: 'buildings.ts:227', notes: '4 张折好的纸箱 #c8a070。', interactions: [] }),
    nb({ id: 'milk_crate', name: '牛奶周转箱', dims: [0.5, 0.3, 0.36], budget: 400, count: 3, source: 'buildings.ts:228', notes: '镂空塑料箱。', variantLabel: '款式', variants: [{ id: 'blue', name: '蓝', color: '#2a6ac8', status: 'pending' }, { id: 'red', name: '红', color: '#d8402a', status: 'pending' }], interactions: [] }),
    nb({ id: 'shop_shutter', name: '卷帘门小店', dims: [5.9, 5.6, 5.7], budget: 4000, count: 2, source: 'buildings.ts:247', notes: '门面：雨檐 #5a5e66、招牌（图集 shopSigns）、拉下的卷帘门（图集 shutter）+ 卷帘盒、二楼两扇窗、楼顶天线。', variantLabel: '款式', variants: [{ id: 'tabako', name: 'たばこ', status: 'pending' }, { id: 'fudosan', name: 'ことぶき不動産', status: 'pending' }], interactions: [] }),
    nb({ id: 'shop_barber', name: '理发店「山田理容」', dims: [4.9, 3.6, 5.7], budget: 3000, count: 1, source: 'buildings.ts:247', notes: '#c8b8a0，雨檐、招牌、卷帘（打烊）。旋转灯柱另列。', interactions: [] }),
    nb({ id: 'barber_pole', name: '理发店转灯', dims: [0.28, 1.09, 0.28], budget: 400, count: 1, source: 'buildings.ts:263', notes: '红白蓝斜条灯柱（发光）+ 顶球；补一个墙上支架。条纹节点 stripes。', interactions: [
      { id: 'spin', label: '旋转', type: 'loop', clip: 'spin', nodes: ['stripes'], note: '新增：游戏里现在不转，有动画后可以接上' },
    ] }),
    nb({ id: 'shop_izakaya', name: '居酒屋「炉端 ほたる」', dims: [5.9, 3.8, 5.7], budget: 5000, count: 1, source: 'buildings.ts:267', notes: '#8a7a6a。木格子拉门（4 块暖光纸窗，发光 #ffe0a8）、暖帘（图集 noren）、招牌（图集 izaSign）、门口啤酒箱和菜单立牌（图集 menu）。灯笼另列。', interactions: [
      { id: 'enter', label: '进门看看', type: 'code', note: '游戏里：叮咚，「いらっしゃい！」…今天满座了' },
    ] }),
    nb({ id: 'izakaya_lantern', name: '居酒屋红灯笼（やきとり）', dims: [0.42, 0.61, 0.42], budget: 400, count: 2, source: 'buildings.ts:276', notes: '图集 lantern，发光；上下黑圈。', interactions: [] }),
    nb({ id: 'shop_cleaning', name: '洗衣店「クリーニング」', dims: [4.9, 5.6, 5.7], budget: 3000, count: 1, source: 'buildings.ts:247', notes: '#b8b0a0，干洗店，卷帘拉下；二楼两扇窗、天线。', interactions: [] }),
    nb({ id: 'office_building', name: '写字楼（含航空障碍灯）', dims: [25.0, 13.2, 2.0], budget: 6000, count: 1, source: 'buildings.ts:306', notes: '正面在世界里朝 −X，只有 1.9 m 深的立面。两段（13 m / 10 m 高），窗户用 window_unit；一楼亮着的玻璃门厅；顶上红色障碍灯（节点 aviation_light）。', interactions: [
      { id: 'blink', label: '障碍灯闪烁', type: 'visibility', nodes: ['aviation_light'], note: '新增：游戏里现在常亮' },
    ] }),
    nb({ id: 'office_annex', name: '东南角楼', dims: [4.8, 9.0, 2.0], budget: 3000, count: 1, source: 'buildings.ts:313', notes: '#9a9a98，6 扇窗。', interactions: [] }),
    S('outdoor')({ id: 'plinth', name: '模型底座（地层剖面 + 木框 + 铭牌）', dims: [41.2, 1.9, 41.2], budget: 600, count: 1, source: 'ground.ts:253', notes: '收藏模型风格的底座：沥青 / 碎石 / 土三层剖面 + 深色木框；前面铜铭牌（图集 nameplate：夜川町 二丁目 · 雨夜 1/50）。路面、标线不建模（游戏里是贴图）。', interactions: [] }),
  ];
}
