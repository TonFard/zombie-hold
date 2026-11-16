import { reactive } from 'vue';
import { GUN_BY_ID } from '../game/data/guns';
import { ui } from './store';

/**
 * 型号 → 侧视图标（用 TACZ 模型画的 PNG）。模型是按需加载的：第一次要的时候还没有，返回空串；
 * 加载好以后这张表更新，模板里用到 gunIconOf 的地方自己重画。界面上给图标留好固定大小的位置，图来了不会挤动别的东西。
 */
const icons = reactive<Record<string, string>>({});
const waiting = new Map<string, number>();
let timer = 0;
/** 等这么多次（每次 200 毫秒）还没有：这个型号的文件读不出来，用这一类的程序模型图标顶上 */
const GIVE_UP = 150;

function tick(): void {
  for (const [id, tries] of [...waiting]) {
    const url = ui.gfx.gunIcon(id);
    if (url) {
      icons[id] = url;
      waiting.delete(id);
    } else if (tries >= GIVE_UP) {
      const cls = GUN_BY_ID[id]?.cls;
      icons[id] = cls ? ui.gfx.icon(cls) : '';
      waiting.delete(id);
    } else waiting.set(id, tries + 1);
  }
  if (!waiting.size) {
    window.clearInterval(timer);
    timer = 0;
  }
}

/** 某个型号的图标；还没画好返回空串（同时开始加载） */
export function gunIconOf(id: string | undefined): string {
  if (!id) return '';
  const hit = icons[id];
  if (hit) return hit;
  if (!waiting.has(id)) {
    waiting.set(id, 0);
    if (!timer) timer = window.setInterval(tick, 200);
  }
  return '';
}
