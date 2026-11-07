// 店铺本体：store.ts（外壳、门窗、灯条、招牌、雨棚、屋顶设备）。尺寸是资产局部坐标（正面 +Z，原点底面中心）。
import type { AssetEntry } from './types';

const A = (a: Omit<AssetEntry, 'category' | 'status'> & { category?: string }): AssetEntry => ({ category: 'building', status: 'pending', ...a });

export function building(): AssetEntry[] {
  return [
    A({ id: 'store_shell', name: '便利店外壳（墙 / 吊顶 / 屋顶板）', dims: [15.1, 3.4, 10.1], budget: 6000, count: 1, source: 'store.ts:61', notes: '原点在店内地坪（世界 y 0.3）。内墙 #f0ece4，外墙 #dcd8d0，0.5 m 深色踢脚 #5a5e66；外墙三色腰线 y2.9 藏青 #1d3d8f / 2.82 青绿 #24b0a0 / 2.74 橙 #f28a24。后墙 x5.2..6.2 开员工门洞（高 2.3）。吊顶 #f4f2ee，1.2 m 分格线。门窗、灯条、招牌、女儿墙另列。', interactions: [] }),
    A({ id: 'store_roof_parapet', name: '屋顶女儿墙（L 形）', dims: [15.1, 0.5, 10.06], budget: 300, count: 1, source: 'store.ts:196', notes: '只有北、西两段，厚 0.15，#dcd8d0。', interactions: [] }),
    A({ id: 'store_window_bay', name: '店面玻璃窗单元', dims: [1.6, 2.9, 0.14], budget: 300, count: 7, source: 'store.ts:97', notes: '竖框 0.07（#3c4048）+ 玻璃（y0.25..2.25，带雨滴的透明材质）+ 下踢板 0.25 高（#2a2e36）+ 横框 + 气窗玻璃。宽 1.6 的 5 格，门右侧 1.2 的 2 格（做成可以 X 向缩放或两个款式）。', variantLabel: '款式', variants: [{ id: 'w160', name: '1.6 m', status: 'pending' }, { id: 'w120', name: '1.2 m', status: 'pending' }], interactions: [] }),
    A({ id: 'store_door_header', name: '自动门门楣 + 感应器', dims: [2.2, 0.88, 0.24], budget: 300, count: 1, source: 'store.ts:123', notes: '门楣 #3c4048，感应器 #222222，红色指示灯（发光）。节点 door_sensor。', interactions: [{ id: 'sensor', label: '自动门感应器', type: 'code', nodes: ['door_sensor'], note: '游戏里：「叮咚～ いらっしゃいませ」' }] }),
    A({ id: 'auto_door', name: '自动推拉门（两扇）', dims: [2.0, 2.1, 0.1], budget: 600, count: 1, source: 'store.ts:253', notes: '两扇 1.0 × 2.1 铝框玻璃门（door_left / door_right），前后错开 5 cm；"自動ドア"贴纸（图集 door）两面贴。打开时左扇往 −X、右扇往 +X 各滑 0.96 m。', interactions: [{ id: 'open', label: '开门 / 关门', type: 'toggle', clip: 'door_open', nodes: ['door_left', 'door_right'], note: '游戏里：人走近自动开（约 0.6 秒），离开后关（约 1.2 秒），播 doorSlide；从外面进店时"叮——咚"。每 25–55 秒会自己开一下' }] }),
    A({ id: 'window_poster', name: '橱窗海报', dims: [0.5, 0.75, 0.01], budget: 20, count: 5, source: 'store.ts:133', notes: '贴在玻璃内侧，两面贴图。', variantLabel: '款式', variants: [['oden', 'おでん 70円'], ['nikuman', '肉まん 新発売'], ['coffee', 'HOT COFFEE S 100円'], ['karaage', 'からあげ 5個入'], ['sale', '2個で10%OFF']].map(([id, name]) => ({ id: id as string, name: name as string, status: 'pending' as const })), interactions: [] }),
    A({ id: 'open24_sticker', name: 'OPEN 24 HOURS 贴纸', dims: [0.36, 0.18, 0.01], budget: 20, count: 1, source: 'store.ts:143', notes: '图集 h24，两面贴，微发光。', interactions: [] }),
    A({ id: 'ceiling_light_bar', name: '吸顶日光灯条', dims: [1.3, 0.07, 0.34], budget: 100, count: 20, source: 'store.ts:150', notes: '灯壳 #d0d0d0 + 下面的发光面 #fff8ec（glow 1.5）。原点在顶面（吸顶安装）。', origin: 'custom', interactions: [] }),
    A({ id: 'security_camera', name: '球形监控摄像头', dims: [0.16, 0.12, 0.16], budget: 300, count: 2, source: 'store.ts:157', notes: '吸顶倒装：白色底座 + 深色半球。原点在顶面。', origin: 'custom', interactions: [] }),
    A({ id: 'ceiling_vent', name: '吸顶空调出风口', dims: [0.7, 0.08, 0.7], budget: 200, count: 2, source: 'store.ts:164', notes: '面板 #e0e0e0 + 4 层逐级缩小的方环 #b8b8b8。原点在顶面。', origin: 'custom', interactions: [] }),
    A({ id: 'store_sign_front', name: '正面发光招牌', dims: [15.34, 1.15, 0.36], budget: 600, count: 1, source: 'store.ts:175', maxTexture: 2048, notes: '灯箱 #f4f4f0 + 发光面（图集 sign：YORU MART / ヨルマート + 月亮标志 + 三色条）+ 金属顶盖。发光面单独节点 sign_face。', interactions: [{ id: 'breathe', label: '招牌亮度', type: 'code', nodes: ['sign_face'], note: '游戏里：亮度 0.97 + 0.03·sin(1.3t) 缓慢起伏' }] }),
    A({ id: 'store_sign_side', name: '侧面发光招牌', dims: [8.0, 1.1, 0.34], budget: 400, count: 1, source: 'store.ts:179', notes: '东墙。同正面招牌，发光面节点 sign_face。', interactions: [{ id: 'flicker', label: '接触不良闪烁', type: 'code', nodes: ['sign_face'], note: '游戏里：大部分时间稳定，偶尔暗到 0.35 闪几下（0.04–0.12 秒）' }] }),
    A({ id: 'store_awning', name: '雨棚（含筒灯）', dims: [15.24, 0.23, 1.24], budget: 600, count: 1, source: 'store.ts:181', notes: '棚板 #e8e8e4，前沿藏青封板 + 铝条，底下 9 盏筒灯（发光 #fff4d8），间距 1.6 m。', interactions: [] }),
    A({ id: 'awning_drain_pipe', name: '雨棚落水管', dims: [0.2, 2.68, 0.18], budget: 150, count: 1, source: 'store.ts:190', notes: '#9aa0a8，底部出水口。', interactions: [] }),
    A({ id: 'rooftop_ac', name: '屋顶空调主机', dims: [1.1, 0.94, 0.6], budget: 400, count: 3, source: 'store.ts:198', notes: '#d8d8d4 机身，顶面风扇 + 十字护栏。', interactions: [] }),
    A({ id: 'rooftop_misc', name: '屋顶通风管 / 检修口 / 排气筒', dims: [1.0, 0.78, 5.0], budget: 400, count: 1, source: 'store.ts:209', notes: '三件分开做也行：方管 0.2 × 0.2 × 5（#9a9a9a）、检修口 1 × 0.15 × 1（#6a6e74）、排气筒 r0.18 高 0.7 + 顶帽。', interactions: [] }),
    A({ id: 'back_door_light', name: '后门壁灯', dims: [0.3, 0.12, 0.2], budget: 100, count: 1, source: 'buildings.ts:232', notes: '#f0f4ff 发光。', interactions: [] }),
  ];
}
