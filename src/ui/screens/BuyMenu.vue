<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { GUN_CATS, type GunCat } from '../../game/data/guns';
import { ARMOR, GEAR, KILL_REWARD, KNIFE, NADE, arenaStats, humanDamage, shelf, type GearId } from '../../game/data/shop';
import { hud } from '../hud';
import { fmtTime, ui } from '../store';

/**
 * 8v8 对战的购买菜单（B）：左边是分类（数字键 1–8），右边是这一类的枪，按价格从低到高。
 * 只在冻结时间、或者开打后头十几秒人还在出生区时开得了；主武器只能带一把，买新的会换掉身上的。
 * 最后一页「装备」：防弹衣、头盔、手雷（刀人人都有，不用买）。
 */
type Tab = GunCat | 'gear';
const TABS: Array<{ id: Tab; name: string; note: string }> = [...GUN_CATS, { id: 'gear', name: '装备', note: '防弹衣挡身上的伤害，头盔挡爆头；这一局活下来，护甲和没扔的手雷都带到下一局' }];

const t = computed(() => hud.tdm);
const open = computed(() => ui.screen === 'buy');
const tab = ref<Tab>('rifle');
const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

interface Row {
  id: string;
  name: string;
  price: number;
  /** 四项数值：伤害、射速、弹匣、射程 */
  stats: string[];
  owned: boolean;
}

const rows = computed<Row[]>(() => {
  const cat = tab.value;
  if (cat === 'gear') return [];
  return shelf(cat).map((r) => {
    const st = arenaStats(r.gun.id);
    const dmg = Math.round(humanDamage(r.gun.id));
    return {
      id: r.gun.id,
      name: r.gun.name,
      price: r.price,
      stats: [st.pellets > 1 ? `${dmg}×${st.pellets}` : `${dmg}`, `${Math.round(st.rate * 60)}`, `${st.mag}`, `${Math.round(st.range)}`],
      owned: t.value.primary === r.gun.id || t.value.pistol === r.gun.id,
    };
  });
});

const gear = computed(() =>
  (Object.keys(GEAR) as GearId[]).map((id) => {
    const full = id === 'nade' ? t.value.nades >= NADE.max : id === 'vest' ? t.value.armor >= ARMOR.max : t.value.helmet;
    return {
      id,
      name: GEAR[id].name,
      note: GEAR[id].note,
      price: GEAR[id].price,
      owned: full,
      /** 买满了的那一格上写什么 */
      ownedText: id === 'nade' ? '已带满' : '已装备',
      state: id === 'nade' ? `已带 ${t.value.nades}/${NADE.max}` : id === 'vest' && t.value.armor > 0 && t.value.armor < ARMOR.max ? `剩 ${t.value.armor}，买了补满` : '',
    };
  }),
);

const info = computed(() => TABS.find((x) => x.id === tab.value) as (typeof TABS)[number]);
const reward = computed(() => (tab.value === 'gear' ? 0 : KILL_REWARD[tab.value]));

// ---- 枪的图片：模型按需加载，加载好之前先空着，隔一会儿再要一次 ----
const icons = reactive<Record<string, string>>({});
let timer = 0;
const fill = (): void => {
  window.clearTimeout(timer);
  if (!open.value) return;
  let missing = false;
  for (const r of rows.value) {
    if (icons[r.id]) continue;
    const url = ui.gfx.gunIcon(r.id);
    if (url) icons[r.id] = url;
    else missing = true;
  }
  if (missing) timer = window.setTimeout(fill, 200);
};
watch([open, tab], fill, { immediate: true });

const onKey = (e: KeyboardEvent): void => {
  if (!open.value || e.repeat) return;
  const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
  if (m) tab.value = (TABS[Number(m[1]) - 1] as (typeof TABS)[number]).id;
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.clearTimeout(timer);
});
</script>

<template>
  <div v-if="open" class="shade" @click.self="ui.actions.closeBuy()">
    <div class="panel" role="dialog" aria-label="购买菜单">
      <header>
        <h2>购买 <small>BUY</small></h2>
        <span class="clock">{{ t.phase === 'freeze' ? '冻结时间' : '还能买' }} <b>{{ fmtTime(t.time) }}</b></span>
        <span class="money">{{ money(t.money) }}</span>
      </header>

      <div class="body">
        <nav aria-label="分类">
          <button v-for="(c, i) in TABS" :key="c.id" class="tab" :class="{ on: tab === c.id }" data-silent @click="tab = c.id">
            <kbd>{{ i + 1 }}</kbd>{{ c.name }}
          </button>
        </nav>

        <section>
          <p class="note">
            {{ info.note }}<template v-if="reward"> · 用它击杀一人 <b>+{{ money(reward) }}</b></template>
            <template v-if="tab === 'gear'"> · 手雷炸死一人 <b>+{{ money(NADE.reward) }}</b>，用刀 <b>+{{ money(KNIFE.reward) }}</b></template>
          </p>

          <template v-if="tab !== 'gear'">
            <div class="cols"><span></span><span>型号</span><span>伤害</span><span>射速/分</span><span>弹匣</span><span>射程/米</span><span>价格</span></div>
            <button v-for="r in rows" :key="r.id" class="buy row" :class="{ owned: r.owned, poor: !r.owned && r.price > t.money }" :aria-disabled="r.owned || r.price > t.money" @click="ui.actions.buyGun(r.id)">
              <span class="pic"><img v-if="icons[r.id]" :src="icons[r.id]" alt="" /></span>
              <span class="name">{{ r.name }}</span>
              <span v-for="(s, i) in r.stats" :key="i" class="num">{{ s }}</span>
              <span class="price">{{ r.owned ? '已装备' : r.price === 0 ? '免费' : money(r.price) }}</span>
            </button>
          </template>

          <template v-else>
            <button v-for="g in gear" :key="g.id" class="buy row gear" :class="{ owned: g.owned, poor: !g.owned && g.price > t.money }" :aria-disabled="g.owned || g.price > t.money" @click="ui.actions.buyGear(g.id)">
              <span class="name">{{ g.name }}</span>
              <span class="desc">{{ g.note }}<em v-if="g.state"> · {{ g.state }}</em></span>
              <span class="price">{{ g.owned ? g.ownedText : money(g.price) }}</span>
            </button>
            <p class="free"><kbd>3</kbd>匕首人人都有，不用买：左键横挥、右键捅，从背后捅一刀毙命；<kbd>V</kbd>拿着枪也能抽刀挥一下</p>
          </template>
        </section>
      </div>

      <footer>
        <span><kbd>1</kbd>–<kbd>8</kbd>选分类 · 点一下就买</span>
        <span>主武器只能带一把：买新的会换掉身上的，不退钱</span>
        <span><kbd>B</kbd>/<kbd>Esc</kbd>关闭</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.shade {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--hud-font);
  color: var(--hud-text);
  background: rgba(3, 5, 8, 0.45);
}
.panel {
  width: min(980px, 94vw);
  /* 高度固定：换分类时面板不跟着行数跳来跳去 */
  height: min(580px, 88vh);
  display: flex;
  flex-direction: column;
  background: rgba(8, 11, 15, 0.94);
  border-top: 2px solid var(--hud-accent);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
}
header {
  display: flex;
  align-items: baseline;
  gap: 18px;
  padding: 14px 22px 10px;
  border-bottom: 1px solid var(--hud-line);
}
h2 {
  flex: 1;
  font-size: 20px;
  letter-spacing: 8px;
}
h2 small {
  margin-left: 6px;
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--hud-muted);
}
.clock {
  font-size: 12px;
  color: var(--hud-muted);
}
.clock b {
  margin-left: 4px;
  font-family: var(--hud-num);
  font-size: 18px;
  color: var(--hud-accent);
}
.money {
  font-family: var(--hud-num);
  font-size: 28px;
  font-weight: 700;
  color: #8fd66a;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 168px 1fr;
  min-height: 0;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 0 12px 12px;
  border-right: 1px solid var(--hud-line);
}
.tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  font: inherit;
  font-size: 14px;
  letter-spacing: 2px;
  text-align: left;
  color: var(--hud-muted);
  background: transparent;
  border: 0;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.tab:hover,
.tab:focus-visible {
  color: var(--hud-text);
  background: rgba(255, 255, 255, 0.05);
  outline: none;
}
.tab.on {
  color: var(--hud-text);
  background: rgba(240, 184, 58, 0.1);
  border-left-color: var(--hud-accent);
}
kbd {
  display: inline-block;
  min-width: 20px;
  padding: 0 5px;
  font: inherit;
  font-size: 11px;
  text-align: center;
  color: var(--hud-muted);
  border: 1px solid var(--hud-line-strong);
}
section {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  padding: 12px 18px 16px;
  overflow-y: auto;
}
.note {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--hud-muted);
}
.note b {
  color: #8fd66a;
  font-weight: 600;
}
.cols,
.row {
  display: grid;
  grid-template-columns: 132px 1fr 62px 62px 52px 62px 86px;
  align-items: center;
  gap: 8px;
}
.cols {
  padding: 0 12px;
  font-size: 11px;
  color: var(--hud-muted);
}
.cols span:nth-child(n + 3),
.num,
.price {
  text-align: right;
}
.row {
  min-height: 46px;
  padding: 2px 12px;
  font: inherit;
  font-size: 14px;
  text-align: left;
  color: var(--hud-text);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid transparent;
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  background: rgba(255, 255, 255, 0.09);
  border-color: var(--hud-line-strong);
  outline: none;
}
.pic {
  height: 42px;
}
.pic img {
  display: block;
  width: 120px;
  height: 42px;
  object-fit: contain;
}
.name {
  font-weight: 600;
  letter-spacing: 1px;
}
.num {
  font-family: var(--hud-num);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--hud-muted);
}
.price {
  font-family: var(--hud-num);
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #8fd66a;
}
.row.poor {
  cursor: not-allowed;
}
.row.poor .name,
.row.poor .pic {
  opacity: 0.45;
}
.row.poor .price {
  color: #d0705e;
}
.row.owned {
  border-color: rgba(240, 184, 58, 0.5);
  cursor: default;
}
.row.owned .price {
  font-family: var(--hud-font);
  font-size: 12px;
  color: var(--hud-accent);
}
.row.gear {
  grid-template-columns: 110px 1fr 86px;
  min-height: 56px;
}
.desc {
  font-size: 12px;
  color: var(--hud-muted);
}
.desc em {
  font-style: normal;
  color: var(--hud-text);
}
.free {
  margin-top: 10px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--hud-muted);
}
.free kbd {
  margin-right: 6px;
}
.free kbd + kbd,
.free kbd:not(:first-child) {
  margin-left: 2px;
}
footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 22px 11px;
  font-size: 11px;
  color: var(--hud-muted);
  border-top: 1px solid var(--hud-line);
}
footer kbd {
  margin: 0 3px;
}
</style>
