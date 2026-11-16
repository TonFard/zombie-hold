<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BENCH_LINES, BENCH_MAX, BENCH_NAME, benchDesc, benchMods, benchPrice, type BenchLine } from '../../game/data/bench';
import { AMMO_LIMITED, WEAPONS, WEAPON_ORDER, effectiveStats, sustainedDps, weightOf, type WeaponKind } from '../../game/data/weapons';
import { benchLevel, bonusesOf, canBench, gunState, gunsFor, masteryOf } from '../../game/meta/progress';
import { GUNS, GUN_BY_ID } from '../../game/data/guns';
import { HOLD_CLASSES } from '../../game/data/features';
import { MASTERY_MAX, MASTERY_PERKS, benchNeeds, masteryProgress, masteryTierCap } from '../../game/data/mastery';
import { STAR_COLOR, STAR_MAX, STAR_TEXT, starXp, starsOf } from '../../game/data/stars';
import { gunIconOf } from '../gun-icons';
import type { IconName } from '../icons';
import TIcon from '../TIcon.vue';
import { ui } from '../store';

/**
 * 武器台：上 一排枪类 / 左 这一类的型号架 / 中 大尺寸 3D 枪模（TACZ 模型，慢慢左右摆，可拖动、滚轮缩放）/
 * 右 属性条（一直在）+ 强化 · 熟练度。
 *
 * 所有"悬停看变化"的数字都放在预先留好的固定格子里（属性条右边那一列、DPS 旁边那一格）：
 * 鼠标移上去只有数字和颜色变，没有哪个格子会变大、把下面的东西挤走。
 */
const meta = computed(() => ui.save.meta);
const bonuses = computed(() => bonusesOf(meta.value));
const unlocked = (k: WeaponKind) => k === 'pistol' || bonuses.value.weapons.has(k);
type Tab = 'bench' | 'mastery';
const tab = ref<Tab>('bench');
const TABS: Array<{ id: Tab; name: string }> = [
  { id: 'bench', name: '强化' },
  { id: 'mastery', name: '熟练度 · 升星' },
];
const CODE: Record<WeaponKind, string> = { pistol: 'PISTOL', smg: 'SMG', shotgun: 'SHOTGUN', rifle: 'RIFLE', sniper: 'SNIPER', lmg: 'LMG' };
const LINE_ICON: Record<BenchLine, IconName> = { damage: 'ammo', recoil: 'recoil', rate: 'rate', lighter: 'weight', mag: 'mag' };

/** 出征时每一类用的型号 */
const picked = computed(() => gunsFor(meta.value));
/** 正在看的那把枪（点仓库里的格子切换）；pick = 它是哪一类 */
const view = ref<string>(picked.value.pistol);
const pick = computed<WeaponKind>(() => GUN_BY_ID[view.value]?.cls ?? 'pistol');
const equipped = computed(() => picked.value[pick.value]);
/** 上面一排的分类：全部，或者某一类枪。切到某一类时，选中这一类正在用的那把 */
type Cat = WeaponKind | 'all';
const cat = ref<Cat>('all');
const setCat = (c: Cat): void => {
  cat.value = c;
  if (c !== 'all' && pick.value !== c) view.value = picked.value[c];
};
/** 仓库右上角的筛选 */
type Filter = 'all' | 'owned' | 'locked';
const filter = ref<Filter>('all');
const FILTERS: Array<{ id: Filter; name: string }> = [
  { id: 'all', name: '全部' },
  { id: 'owned', name: '已拥有' },
  { id: 'locked', name: '未解锁' },
];

/** 一组属性的数值（当前强化等级，或者假设某条线多买一级；型号 = 正在看的 / 正在用的） */
function statsFor(k: WeaponKind, bench: Record<string, number>, gunId: string) {
  const mods = benchMods(bench)[k];
  const gun = GUN_BY_ID[gunId];
  const st = effectiveStats(k, 0, mods, gun);
  return { st, dps: sustainedDps(st), weight: weightOf(k, mods, gun), recoil: WEAPONS[k].recoil.v * (gun?.recoil ?? 1) * mods.recoil };
}

// ---- 上面一排枪类 ----
const classes = computed(() =>
  WEAPON_ORDER.filter((k) => HOLD_CLASSES.includes(k)).map((k) => {
    const xp = meta.value.mastery[k] ?? 0;
    const p = masteryProgress(k, xp);
    const frac = p.to === null ? 0 : (xp - p.from) / (p.to - p.from);
    return { k, name: WEAPONS[k].name, code: CODE[k], on: unlocked(k), gun: GUN_BY_ID[picked.value[k]]?.name ?? '', lv: p.lv, pct: Math.min(1, (p.lv + frac) / MASTERY_MAX), stars: starsOf(k, xp) };
  }),
);

// ---- 仓库：所有型号一格一把（GUNS 本来就按枪类排好了）----
const all = computed(() => GUNS.filter((g) => HOLD_CLASSES.includes(g.cls)).map((g) => ({ g, state: gunState(meta.value, g.id), on: picked.value[g.cls] === g.id, icon: gunIconOf(g.id), cls: WEAPONS[g.cls].name })));
const models = computed(() => all.value.filter((m) => (cat.value === 'all' || m.g.cls === cat.value) && (filter.value === 'all' || (filter.value === 'owned') === (m.state === 'owned'))));
const owned = computed(() => all.value.filter((m) => m.state === 'owned').length);
const cur = computed(() => all.value.find((m) => m.g.id === view.value) ?? all.value[0]!);
/** 解锁不了的原因（按钮下面那一行，位置固定） */
const why = computed(() => {
  const m = cur.value;
  if (m.state === 'class') return '先在军械库解锁这一类枪';
  if (m.state === 'mastery') return `这一类的熟练度要到 ${m.g.mastery} 级（现在 ${masteryOf(meta.value, pick.value)} 级）`;
  if (m.state === 'medals') return `勋章还差 ${m.g.medals - meta.value.medals}`;
  if (m.state === 'ok') return '解锁以后可以装备；空投里也能捡到试用一局';
  return m.on ? '出征时这一类用的就是它' : '点「装备」，下一局起这一类用它';
});

const w = computed(() => {
  const k = pick.value;
  const def = WEAPONS[k];
  const xp = meta.value.mastery[k] ?? 0;
  const p = masteryProgress(k, xp);
  // 精通之后：升星进度。起点 = 上一颗星的门槛（0 星时是精通门槛）
  const stars = starsOf(k, xp);
  const sFrom = stars === 0 ? (p.lv >= MASTERY_MAX ? p.from : 0) : starXp(k, stars);
  const sTo = stars < STAR_MAX ? starXp(k, stars + 1) : null;
  const starPct = sTo === null ? 1 : (xp - sFrom) / (sTo - sFrom);
  return {
    k,
    def,
    on: unlocked(k),
    stock: k === 'pistol' ? Infinity : meta.value.ammo[k] ?? 0,
    mastery: { ...p, xp, pct: p.to === null ? 1 : (xp - p.from) / (p.to - p.from), cap: masteryTierCap(p.lv), stars, starTo: sTo, starPct: Math.max(0, Math.min(1, starPct)) },
    lines: BENCH_LINES.map((line: BenchLine) => {
      const lv = benchLevel(meta.value, k, line);
      const state = canBench(meta.value, k, line);
      const need = benchNeeds(lv);
      const price = lv < BENCH_MAX ? benchPrice(k, lv) : 0;
      // 买不了的时候，按钮下面那一小行写原因（那一行一直占着位置）
      const note = state === 'locked' ? '先在军械库解锁' : state === 'mastery' ? `需要熟练度 ${need}` : state === 'supplies' ? `补给还差 ${price - meta.value.supplies}` : '';
      return { line, name: BENCH_NAME[line], icon: LINE_ICON[line], lv, now: benchDesc(k, line, lv), next: lv < BENCH_MAX ? benchDesc(k, line, lv + 1) : '', price, state, note };
    }),
  };
});

// ---- 属性条：刻度按全部武器的范围定（伤害最高的狙击 130、射速最高的冲锋枪 13 发/秒……）----
const hoverLine = ref<BenchLine | null>(null);
/** 正在用的型号（对比的基准）、正在看的型号、悬停的强化线买了以后 */
const base = computed(() => statsFor(pick.value, meta.value.bench, equipped.value));
const shown = computed(() => statsFor(pick.value, meta.value.bench, view.value));
const next = computed(() => {
  const line = hoverLine.value;
  if (!line) return null;
  const lv = benchLevel(meta.value, pick.value, line);
  if (lv >= BENCH_MAX) return null;
  return statsFor(pick.value, { ...meta.value.bench, [`${pick.value}.${line}`]: lv + 1 }, view.value);
});
// 换了枪类 / 切了 Tab：鼠标底下那一行已经不在了，不会再收到 mouseleave，手动清掉
watch([pick, tab], () => {
  hoverLine.value = null;
});
type S = ReturnType<typeof statsFor>;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
interface Bar {
  k: string;
  icon: IconName;
  /** 条的长度 0–1 */
  f: (s: S) => number;
  /** 显示的数值（带单位）、不带单位的短写（「→ 13.5」那一格用） */
  v: (s: S) => string;
  short: (s: S) => string;
  /** 原始数值（算两把枪的差）、差值保留几位小数、是不是越小越好 */
  n: (s: S) => number;
  digits: number;
  low?: boolean;
}
const BARS: Bar[] = [
  { k: '伤害', icon: 'damage', f: (s) => clamp((s.st.damage * s.st.pellets) / 130), v: (s) => `${s.st.damage.toFixed(0)}${s.st.pellets > 1 ? ` × ${s.st.pellets}` : ''}`, short: (s) => `${s.st.damage.toFixed(0)}${s.st.pellets > 1 ? `×${s.st.pellets}` : ''}`, n: (s) => s.st.damage * s.st.pellets, digits: 0 },
  { k: '射速', icon: 'rate', f: (s) => clamp(s.st.rate / 14), v: (s) => `${s.st.rate.toFixed(1)} 发/秒`, short: (s) => s.st.rate.toFixed(1), n: (s) => s.st.rate, digits: 1 },
  { k: '弹匣', icon: 'mag', f: (s) => clamp(Math.sqrt(s.st.mag / 100)), v: (s) => `${s.st.mag} 发`, short: (s) => String(s.st.mag), n: (s) => s.st.mag, digits: 0 },
  { k: '换弹', icon: 'reload', f: (s) => clamp(1 - (s.st.reload - 0.8) / 3.6), v: (s) => `${s.st.reload.toFixed(1)} 秒`, short: (s) => s.st.reload.toFixed(1), n: (s) => s.st.reload, digits: 1, low: true },
  { k: '射程', icon: 'range', f: (s) => clamp(s.st.range / 60), v: (s) => `${s.st.range.toFixed(0)} 米`, short: (s) => s.st.range.toFixed(0), n: (s) => s.st.range, digits: 0 },
  { k: '后坐', icon: 'recoil', f: (s) => clamp(1 - s.recoil / 4.5), v: (s) => `${s.recoil.toFixed(1)}°`, short: (s) => s.recoil.toFixed(1), n: (s) => s.recoil, digits: 1, low: true },
  { k: '重量', icon: 'weight', f: (s) => clamp(s.weight / 10), v: (s) => `${s.weight.toFixed(1)} kg`, short: (s) => s.weight.toFixed(1), n: (s) => s.weight, digits: 1, low: true },
];
const signed = (d: number, digits: number): string => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}`;
/** 和正在用的型号不是同一把：属性条上画出它的位置，右边那一格写差多少 */
const comparing = computed(() => view.value !== equipped.value);
const bars = computed(() =>
  BARS.map((b) => {
    const a = b.f(shown.value);
    const n = next.value ? b.f(next.value) : a;
    // 右边那一格：悬停强化线 → 买了以后的数值；在看别的型号 → 和正在用的那把差多少；否则空着
    let side = '';
    let tone: '' | 'up' | 'down' = '';
    if (next.value) {
      if (b.short(next.value) !== b.short(shown.value)) {
        side = `→ ${b.short(next.value)}`;
        tone = 'up';
      }
    } else if (comparing.value) {
      const d = b.n(shown.value) - b.n(base.value);
      if (Math.abs(d) >= 0.5 * 10 ** -b.digits) {
        side = signed(d, b.digits);
        tone = d > 0 !== !!b.low ? 'up' : 'down';
      }
    }
    return { k: b.k, icon: b.icon, pct: a * 100, gain: Math.max(0, n - a) * 100, mark: comparing.value ? b.f(base.value) * 100 : -1, v: b.v(shown.value), side, tone, heavy: b.k === '重量' && shown.value.weight > 5 };
  }),
);
/** DPS 旁边那一格 */
const dpsSide = computed(() => {
  if (next.value) return Math.abs(next.value.dps - shown.value.dps) > 0.5 ? { text: `→ ${next.value.dps.toFixed(0)}`, tone: 'up' } : null;
  if (!comparing.value) return null;
  const d = shown.value.dps - base.value.dps;
  return Math.abs(d) >= 0.5 ? { text: signed(d, 0), tone: d > 0 ? 'up' : 'down' } : null;
});

// ---- 3D 展示：跟着容器大小走 ----
const stageEl = ref<HTMLDivElement | null>(null);
let preview: ReturnType<typeof ui.gfx.preview> = null;
let ro: ResizeObserver | null = null;
const loading = ref(false);
let loadTimer = 0;
const showGun = (): void => {
  preview?.setGun(view.value, pick.value);
  loading.value = true;
};
onMounted(() => {
  const el = stageEl.value;
  if (!el) return;
  preview = ui.gfx.preview(Math.max(2, el.clientWidth), Math.max(2, el.clientHeight));
  if (!preview) return;
  el.appendChild(preview.canvas);
  showGun();
  ro = new ResizeObserver(() => preview?.resize(el.clientWidth, el.clientHeight));
  ro.observe(el);
  loadTimer = window.setInterval(() => {
    loading.value = preview?.loading ?? false;
  }, 150);
});
watch(view, showGun);
onBeforeUnmount(() => {
  window.clearInterval(loadTimer);
  ro?.disconnect();
  preview?.dispose();
});
</script>

<template>
  <section class="armory t-enter">
    <!-- 上：分类（全部 + 守城现在开放的几类枪，每一类带熟练度的环） -->
    <nav class="classes" aria-label="分类">
      <button class="cls all" :class="{ on: cat === 'all' }" :aria-pressed="cat === 'all'" @click="setCat('all')">
        <span class="ctx">
          <b>全部</b>
          <small>ALL · {{ owned }} / {{ all.length }}</small>
        </span>
        <span class="clock"><TIcon name="crate" /></span>
      </button>
      <button v-for="c in classes" :key="c.k" class="cls" :class="{ on: cat === c.k, locked: !c.on }" :aria-pressed="cat === c.k" @click="setCat(c.k)">
        <span class="ctx">
          <b>{{ c.name }}</b>
          <small>{{ c.code }}<template v-if="c.on"> · {{ c.gun }}</template><template v-else> · 未解锁</template></small>
        </span>
        <span v-if="!c.on" class="clock"><TIcon name="lock" /></span>
        <svg v-else class="ring" :class="{ max: c.lv >= MASTERY_MAX }" viewBox="0 0 36 36" :aria-label="`熟练度 ${c.lv} / ${MASTERY_MAX}`">
          <circle class="tr" cx="18" cy="18" r="15" />
          <circle class="pr" cx="18" cy="18" r="15" :stroke-dasharray="`${(c.pct * 94.25).toFixed(1)} 94.25`" transform="rotate(-90 18 18)" />
          <text x="18" y="22.6" text-anchor="middle">{{ c.lv }}</text>
        </svg>
      </button>
    </nav>

    <!-- 左：仓库，一格一把枪 -->
    <aside class="store t-panel" aria-label="仓库">
      <div class="store-head">
        <div class="t-head">仓库 <small>STORAGE · {{ models.length }} 把</small></div>
        <div class="t-seg fseg" role="group" aria-label="筛选">
          <button v-for="f in FILTERS" :key="f.id" :class="{ on: filter === f.id }" :aria-pressed="filter === f.id" @click="filter = f.id">{{ f.name }}</button>
        </div>
      </div>
      <div class="cells">
        <button v-for="m in models" :key="m.g.id" class="cell" :class="{ on: view === m.g.id, eq: m.on, off: m.state !== 'owned', can: m.state === 'ok' }" :aria-pressed="view === m.g.id" @click="view = m.g.id">
          <span v-if="m.on" class="badge">使用中</span>
          <span v-else-if="m.state !== 'owned'" class="badge lock"><TIcon name="lock" /></span>
          <span class="gpic"><img v-if="m.icon" :src="m.icon" alt="" /></span>
          <b>{{ m.g.name }}</b>
          <small v-if="m.state === 'owned'">{{ m.cls }}</small>
          <small v-else class="need">熟练 {{ m.g.mastery }} · <TIcon name="medal" />{{ m.g.medals }}</small>
        </button>
        <p v-if="!models.length" class="empty">这个分类里没有符合筛选的枪</p>
      </div>
      <p class="rack-note">同一类的型号共用熟练度、升星和强化，只是手感和数值的取舍不同。解锁了的枪出征时直接带，不用在局内买。</p>
    </aside>

    <!-- 中：展示台 + 属性 -->
    <div class="mid">
    <!-- 中：展示台 -->
    <div class="stage">
      <div class="halo" aria-hidden="true"></div>
      <svg class="reticle" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="78" />
        <circle class="dash" cx="100" cy="100" r="88" />
        <path d="M100 6v12M100 182v12M6 100h12M182 100h12" />
        <path class="thin" d="M100 40v8M100 152v8M40 100h8M152 100h8" />
      </svg>
      <i class="cn tl" aria-hidden="true"></i><i class="cn tr" aria-hidden="true"></i><i class="cn bl" aria-hidden="true"></i><i class="cn br" aria-hidden="true"></i>
      <div ref="stageEl" class="canvas" title="拖动旋转 · 滚轮缩放" aria-label="武器 3D 展示"></div>
      <div class="tag">
        <b>{{ CODE[w.k] }}</b>
        <span>{{ w.def.name }} · {{ w.def.role }}</span>
      </div>
      <p class="hint"><TIcon name="rotate" />拖动旋转 · 滚轮缩放</p>
      <div class="mline"><span class="star" :style="{ color: STAR_COLOR[w.mastery.stars] }"><TIcon v-for="i in STAR_MAX" :key="i" name="star" :class="{ dim: i > w.mastery.stars }" /></span><span class="ml">{{ w.def.name }}熟练度 <b>{{ w.mastery.lv }}</b>/{{ MASTERY_MAX }}</span></div>
      <p v-if="loading" class="loading">模型加载中…</p>
      <div class="cap">
        <div class="cap-l">
          <h3>{{ cur.g.name }}</h3>
          <p class="desc">{{ cur.g.desc }}</p>
        </div>
        <div class="cap-r">
          <div v-if="cur.on" class="inuse"><TIcon name="check" />使用中</div>
          <button v-else-if="cur.state === 'owned'" class="t-btn act" @click="ui.actions.pickGun(w.k, cur.g.id)">装 备</button>
          <button v-else class="t-btn gold act" :disabled="cur.state !== 'ok'" @click="ui.actions.unlockGun(cur.g.id)"><TIcon name="medal" />{{ cur.g.medals }} 解锁</button>
          <small :class="{ bad: cur.state === 'class' || cur.state === 'mastery' || cur.state === 'medals' }">{{ why }}</small>
        </div>
      </div>
    </div>

      <div class="stats t-panel">
        <div class="dps">
          <TIcon name="dps" />
          <span>持续 DPS<small>1 级 · 含换弹</small></span>
          <b>{{ shown.dps.toFixed(0) }}</b>
          <em :class="dpsSide?.tone">{{ dpsSide?.text ?? '' }}</em>
        </div>
        <div class="bars">
          <div v-for="b in bars" :key="b.k" class="row">
            <TIcon :name="b.icon" />
            <span>{{ b.k }}</span>
            <i class="track">
              <b :class="{ heavy: b.heavy }" :style="{ width: b.pct + '%' }"></b>
              <s v-if="b.gain > 0" :style="{ left: b.pct + '%', width: b.gain + '%' }"></s>
              <u v-if="b.mark >= 0" :style="{ left: b.mark + '%' }"></u>
            </i>
            <em>{{ b.v }}</em>
            <strong :class="b.tone">{{ b.side }}</strong>
          </div>
        </div>
        <p class="note">{{ comparing ? `竖线 = 正在用的「${GUN_BY_ID[equipped]?.name ?? ''}」，右边是差多少。` : '悬停一条强化线，这里显示买了以后的数值。' }}超过 3 kg 每千克移速 −3%。</p>
        <div v-if="AMMO_LIMITED && w.k !== 'pistol'" class="ammo">
          <span>弹药库存 <b>{{ w.stock }}</b> 发</span>
          <button class="t-btn gold" :disabled="!w.on || meta.supplies < (w.def.ammo?.price ?? 0)" @click="ui.actions.buyAmmo(w.k, 1)">+{{ w.def.ammo?.pack }} · <TIcon name="supply" />{{ w.def.ammo?.price }}</button>
          <button class="t-btn gold" :disabled="!w.on || meta.supplies < (w.def.ammo?.price ?? 0) * 5" @click="ui.actions.buyAmmo(w.k, 5)">+{{ (w.def.ammo?.pack ?? 0) * 5 }} · <TIcon name="supply" />{{ (w.def.ammo?.price ?? 0) * 5 }}</button>
        </div>

        </div>
    </div>

    <!-- 右：强化 / 熟练度 -->
    <aside class="info t-panel">
      <div class="tabs t-seg" role="tablist">
        <button v-for="t in TABS" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.name }}</button>
      </div>

      <!-- 强化：每条线一行，高度固定 -->
      <div v-if="tab === 'bench'" class="pane" role="tabpanel">
        <div v-for="l in w.lines" :key="l.line" class="line" :class="{ maxed: l.state === 'maxed', hot: hoverLine === l.line }" @mouseenter="hoverLine = l.line" @mouseleave="hoverLine = null" @focusin="hoverLine = l.line" @focusout="hoverLine = null">
          <span class="lico"><TIcon :name="l.icon" /></span>
          <div class="ltx">
            <div class="lh">
              <b>{{ l.name }}</b>
              <span class="pips" :aria-label="`${l.lv} / ${BENCH_MAX} 级`"><i v-for="i in BENCH_MAX" :key="i" :class="{ on: i <= l.lv }"></i></span>
            </div>
            <div class="ld"><span class="now">{{ l.lv > 0 ? l.now : '未强化' }}</span><template v-if="l.next"><TIcon name="chevron" /><b>{{ l.next }}</b></template></div>
          </div>
          <div class="lbuy">
            <button v-if="l.state !== 'maxed'" class="t-btn gold" :disabled="l.state !== 'ok'" @click="ui.actions.buyBench(w.k, l.line)"><TIcon name="supply" />{{ l.price }}</button>
            <div v-else class="done"><TIcon name="check" />已满级</div>
            <small>{{ l.note }}</small>
          </div>
        </div>
        <p class="note">永久生效，每局都带着；同一类的所有型号共用。每一级要先把这一类练到对应的熟练度。</p>
      </div>

      <!-- 熟练度与升星 -->
      <div v-else class="pane" role="tabpanel">
        <div class="mh"><span>熟练度</span><b>{{ w.mastery.lv }} / {{ MASTERY_MAX }}</b></div>
        <div class="mbar big"><i :style="{ width: `${Math.round(w.mastery.pct * 100)}%` }"></i></div>
        <p class="note">{{ w.mastery.to === null ? `已精通（${w.mastery.xp} 经验）` : `${w.mastery.xp} / ${w.mastery.to} 经验` }} · 用它击杀 +1，爆头击杀再 +1 · 局内工坊最高 {{ w.mastery.cap }} 级</p>
        <ol class="perks">
          <li v-for="(t, i) in MASTERY_PERKS" :key="i" :class="{ on: w.mastery.lv > i }"><b>{{ i + 1 }}</b>{{ t }}</li>
        </ol>
        <div class="mh star-h">
          <span>升星</span>
          <b :style="{ color: STAR_COLOR[w.mastery.stars] }">{{ w.mastery.stars }} / {{ STAR_MAX }}</b>
        </div>
        <template v-if="w.mastery.lv >= MASTERY_MAX">
          <div class="mbar big"><i :style="{ width: `${Math.round(w.mastery.starPct * 100)}%`, background: STAR_COLOR[Math.min(STAR_MAX, w.mastery.stars + 1)] }"></i></div>
          <p class="note">{{ w.mastery.starTo === null ? '已满星' : `${w.mastery.xp} / ${w.mastery.starTo} 经验到下一颗星` }}</p>
        </template>
        <p v-else class="note">精通（熟练度 {{ MASTERY_MAX }}）之后继续用它杀怪，每颗星一个特性（出征时生效）</p>
        <ol class="perks">
          <li v-for="(t, i) in STAR_TEXT[w.k]" :key="i" :class="{ on: w.mastery.stars > i }" :style="w.mastery.stars > i ? { borderColor: STAR_COLOR[i + 1], color: STAR_COLOR[i + 1] } : undefined">
            <b class="sb"><TIcon v-for="n in i + 1" :key="n" name="star" /></b>{{ t }}
          </li>
        </ol>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.armory {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px 396px;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px 16px;
  height: 100%;
  min-height: 0;
}
.t-ico {
  width: 1em;
  height: 1em;
  flex: none;
}

/* ---------- 上：枪类 ---------- */
.classes {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}
.cls {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  gap: 10px;
  height: 58px;
  padding: 0 12px 0 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012));
  border: 1px solid var(--t-line);
  color: var(--t-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
  transition: border-color 0.15s var(--t-ease), background 0.15s var(--t-ease);
}
.cls::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--t-gold);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.2s var(--t-ease);
}
.cls:hover,
.cls:focus-visible {
  outline: none;
  border-color: var(--t-line-strong);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
}
.cls.on {
  border-color: rgba(240, 184, 58, 0.55);
  background: linear-gradient(180deg, rgba(240, 184, 58, 0.14), rgba(240, 184, 58, 0.03));
}
.cls.on::after {
  transform: scaleX(1);
}
.cls.locked {
  color: var(--t-muted);
}
/* 图标是异步画出来的：格子大小写死，图来了不挤别的东西 */
.cpic {
  width: 84px;
  height: 30px;
  background: radial-gradient(ellipse at center, rgba(200, 215, 230, 0.16), transparent 70%);
}
.cpic img,
.gpic img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(1.55) contrast(1.08);
}
.locked .cpic img {
  filter: grayscale(1) brightness(0.9);
  opacity: 0.6;
}
.ctx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ctx b {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctx small {
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--t-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cls.on .ctx small {
  color: var(--t-gold-soft);
}
.clock {
  justify-self: center;
  font-size: 17px;
  color: var(--t-dim);
}
.ring {
  width: 34px;
  height: 34px;
}
.ring circle {
  fill: none;
  stroke-width: 2.4;
}
.ring .tr {
  stroke: rgba(255, 255, 255, 0.1);
}
.ring .pr {
  stroke: var(--t-cyan);
  stroke-linecap: butt;
}
.ring.max .pr {
  stroke: var(--t-gold);
}
.ring text {
  fill: var(--t-text);
  font: 600 13px var(--t-mono);
  stroke: none;
}
.ring.max text {
  fill: var(--t-gold);
}

/* ---------- 左：仓库（一格一把枪） ---------- */
.store {
  display: flex;
  flex-direction: column;
  padding: 14px 12px 12px;
  min-height: 0;
}
.store-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.store-head .t-head {
  flex: 1;
}
.fseg {
  flex: none;
  flex-wrap: nowrap;
  gap: 4px;
}
.fseg button {
  flex: none;
  padding: 5px 12px;
  font-size: 12px;
}
/* 格子大小写死（行高固定、列宽平分），悬停 / 选中只换边框和底色 */
.cells {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  grid-auto-rows: 132px;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 3px;
}
.cell {
  position: relative;
  display: grid;
  grid-template-rows: 70px 22px 18px;
  justify-items: center;
  align-content: center;
  gap: 3px;
  padding: 6px 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012));
  border: 1px solid var(--t-line);
  color: var(--t-text);
  font: inherit;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
  transition: border-color 0.15s var(--t-ease), background 0.15s var(--t-ease);
}
.cell:hover,
.cell:focus-visible {
  outline: none;
  border-color: var(--t-line-strong);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}
.cell.eq {
  border-color: rgba(240, 184, 58, 0.45);
}
.cell.on {
  border-color: var(--t-cyan);
  background: linear-gradient(180deg, rgba(111, 208, 232, 0.16), rgba(111, 208, 232, 0.03));
}
/* 图是异步画出来的：位置先占好 */
.gpic {
  width: 100%;
  height: 70px;
  background: radial-gradient(ellipse at center, rgba(200, 215, 230, 0.14), transparent 68%);
}
.gpic img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(1.55) contrast(1.08);
}
.cell.off .gpic img {
  filter: grayscale(0.9) brightness(1.05);
  opacity: 0.6;
}
.cell b {
  max-width: 100%;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell.off b {
  color: var(--t-muted);
}
.cell small {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  line-height: 18px;
  color: var(--t-dim);
  white-space: nowrap;
}
.cell .need .t-ico {
  font-size: 11px;
  color: var(--t-gold);
}
.cell.can .need {
  color: var(--t-gold-soft);
}
.badge {
  position: absolute;
  left: 0;
  top: 0;
  padding: 1px 7px;
  font-size: 10px;
  letter-spacing: 1px;
  line-height: 16px;
  color: #0b0f14;
  background: var(--t-gold);
}
.badge.lock {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 12px;
  color: var(--t-dim);
  background: rgba(8, 12, 18, 0.7);
}
.empty {
  grid-column: 1 / -1;
  align-self: center;
  text-align: center;
  font-size: 13px;
  color: var(--t-dim);
}
.rack-note {
  flex: none;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--t-line);
  font-size: 11px;
  line-height: 1.6;
  color: var(--t-dim);
}

/* ---------- 中：展示台 + 属性 ---------- */
.mid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.mid .stage {
  flex: 1 1 0;
}
.stats {
  flex: none;
  padding: 12px 16px 10px;
}
.stats > .note {
  height: 36px;
  overflow: hidden;
}

/* ---------- 中：展示台 ---------- */
.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--t-line);
  background: linear-gradient(180deg, rgba(8, 12, 18, 0.3), rgba(8, 12, 18, 0.72));
  overflow: hidden;
}
/* 中心一圈蓝绿的光 + 地面的椭圆光斑 + 细网格 */
.halo {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 55% 40% at 50% 44%, rgba(111, 208, 232, 0.12), transparent 70%),
    radial-gradient(ellipse 36% 6% at 50% 71%, rgba(240, 184, 58, 0.18), transparent 70%),
    linear-gradient(rgba(111, 208, 232, 0.045) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, rgba(111, 208, 232, 0.045) 1px, transparent 1px) 0 0 / 40px 40px;
  pointer-events: none;
}
/* 枪后面的瞄准环：只是装饰，不动 */
.reticle {
  position: absolute;
  left: 50%;
  top: calc((100% - 118px) / 2);
  width: min(74%, 620px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  fill: none;
  stroke: rgba(111, 208, 232, 0.2);
  stroke-width: 0.5;
  pointer-events: none;
}
.reticle .dash {
  stroke-dasharray: 1.5 5;
  stroke: rgba(111, 208, 232, 0.3);
}
.reticle .thin {
  stroke: rgba(240, 184, 58, 0.45);
}
.cn {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 0 solid rgba(111, 208, 232, 0.7);
  pointer-events: none;
}
.cn.tl {
  left: 8px;
  top: 8px;
  border-width: 2px 0 0 2px;
}
.cn.tr {
  right: 8px;
  top: 8px;
  border-width: 2px 2px 0 0;
}
.cn.bl {
  left: 8px;
  bottom: 8px;
  border-width: 0 0 2px 2px;
}
.cn.br {
  right: 8px;
  bottom: 8px;
  border-width: 0 2px 2px 0;
}
.canvas {
  position: absolute;
  inset: 0 0 118px;
}
.canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.mline {
  position: absolute;
  left: 22px;
  bottom: 126px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--t-muted);
  pointer-events: none;
}
.tag {
  position: absolute;
  left: 22px;
  top: 20px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  pointer-events: none;
}
.tag b {
  padding: 1px 8px;
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 3px;
  color: #06202a;
  background: var(--t-cyan);
}
.tag span {
  font-size: 12px;
  color: var(--t-muted);
}
.hint {
  position: absolute;
  bottom: 126px;
  right: 22px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--t-dim);
  pointer-events: none;
}
.hint .t-ico {
  font-size: 13px;
}
.loading {
  position: absolute;
  left: 0;
  right: 0;
  top: calc((100% - 118px) / 2 - 8px);
  text-align: center;
  font-family: var(--t-mono);
  font-size: 12px;
  letter-spacing: 4px;
  color: var(--t-dim);
  pointer-events: none;
}
/* 底部说明条：高度固定。上面名字和说明，下面一行是「装备 / 解锁」按钮和原因；换型号时都不动 */
.cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 118px;
  display: grid;
  grid-template-rows: 58px 40px;
  align-content: center;
  gap: 6px;
  padding: 0 22px;
  border-top: 1px solid var(--t-line);
  background: linear-gradient(180deg, rgba(8, 12, 18, 0.2), rgba(8, 12, 18, 0.75));
}
.cap-l {
  min-width: 0;
}
.cap h3 {
  font-size: 25px;
  line-height: 32px;
  letter-spacing: 3px;
  color: #eef1f3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 20px;
  color: var(--t-cyan);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.star {
  display: flex;
  gap: 2px;
  font-size: 14px;
}
.star .dim {
  color: rgba(255, 255, 255, 0.14);
}
.ml b {
  font-family: var(--t-mono);
  font-size: 15px;
  color: var(--t-gold);
}
.mbar {
  flex: 1;
  max-width: 220px;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
}
.mbar i {
  display: block;
  height: 100%;
  background: var(--t-gold);
  transition: width 0.25s var(--t-ease);
}
.mbar.big {
  max-width: none;
  height: 6px;
}
.cap-r {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.act,
.inuse {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  padding: 0;
  font-size: 15px;
  letter-spacing: 3px;
}
.inuse {
  border: 1px solid rgba(240, 184, 58, 0.45);
  color: var(--t-gold);
  background: rgba(240, 184, 58, 0.07);
}
/* 原因：按钮右边那一格，最多两行（格子大小固定，字多字少按钮都不动） */
.cap-r small {
  max-height: 34px;
  font-size: 11.5px;
  line-height: 17px;
  color: var(--t-dim);
  overflow: hidden;
}
.cap-r small.bad {
  color: #e0a08f;
}

/* ---------- 右：属性 + 强化 ---------- */
.info {
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  min-height: 0;
}
.dps {
  flex: none;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto 58px;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--t-line);
}
.dps > .t-ico {
  font-size: 24px;
  color: var(--t-gold);
}
.dps span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  letter-spacing: 3px;
  color: var(--t-gold-soft);
}
.dps small {
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--t-dim);
}
.dps em {
  align-self: end;
  padding-bottom: 5px;
  font-style: normal;
  font-family: var(--t-mono);
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
}
.dps b {
  min-width: 74px;
  text-align: right;
  font-family: var(--t-mono);
  font-size: 36px;
  font-weight: 600;
  line-height: 1;
  color: var(--t-gold);
  font-variant-numeric: tabular-nums;
}
.up {
  color: var(--t-ok);
}
.down {
  color: var(--t-red);
}
.bars {
  flex: none;
  display: grid;
  gap: 0;
  margin-top: 8px;
}
.row {
  display: grid;
  grid-template-columns: 16px 30px minmax(0, 1fr) 84px 58px;
  align-items: center;
  gap: 8px;
  height: 25px;
  font-size: 12.5px;
  color: var(--t-muted);
}
.row > .t-ico {
  font-size: 15px;
  color: var(--t-dim);
}
.track {
  position: relative;
  height: 6px;
  background: rgba(255, 255, 255, 0.07);
}
.track b,
.track s {
  position: absolute;
  inset: 0 auto 0 0;
  transition: width 0.25s var(--t-ease), left 0.25s var(--t-ease);
}
.track b {
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.5), var(--t-gold));
}
.track b.heavy {
  background: linear-gradient(90deg, rgba(232, 160, 63, 0.5), #e8a03f);
}
.track s {
  background: var(--t-ok);
  opacity: 0.8;
}
/* 正在用的那把在这条上的位置 */
.track u {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: #fff;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.7);
  transition: left 0.25s var(--t-ease);
}
.row em {
  font-style: normal;
  text-align: right;
  font-family: var(--t-mono);
  font-variant-numeric: tabular-nums;
  color: var(--t-text);
  white-space: nowrap;
}
.row strong {
  font-weight: 400;
  font-family: var(--t-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.note {
  flex: none;
  margin-top: 8px;
  font-size: 11px;
  line-height: 18px;
  color: var(--t-dim);
}
.ammo {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--t-muted);
}
.ammo span {
  margin-right: auto;
}
.ammo b {
  font-family: var(--t-mono);
  font-size: 16px;
  color: var(--t-text);
}
.ammo .t-btn {
  padding: 5px 10px;
  font-size: 12px;
  letter-spacing: 1px;
}
.tabs {
  flex: none;
  margin: 0 0 10px;
}
.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}
/* 一条强化线：图标 / 名字 + 效果 / 价格。高度固定，悬停只变边框和底色 */
.line {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 104px;
  align-items: center;
  gap: 10px;
  height: 60px;
  margin-bottom: 6px;
  padding: 0 10px 0 8px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--t-line);
  transition: border-color 0.15s var(--t-ease), background 0.15s var(--t-ease);
}
.line.hot {
  border-color: rgba(240, 184, 58, 0.5);
  background: rgba(240, 184, 58, 0.05);
}
.line.maxed {
  border-color: rgba(111, 208, 232, 0.3);
}
.lico {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  font-size: 20px;
  color: var(--t-gold);
  border: 1px solid rgba(240, 184, 58, 0.3);
  background: rgba(240, 184, 58, 0.06);
  clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px));
}
.maxed .lico {
  color: var(--t-cyan);
  border-color: rgba(111, 208, 232, 0.35);
  background: rgba(111, 208, 232, 0.06);
}
.ltx {
  min-width: 0;
}
.lh {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  letter-spacing: 2px;
}
.pips {
  display: flex;
  gap: 3px;
}
.pips i {
  width: 13px;
  height: 5px;
  background: rgba(255, 255, 255, 0.15);
}
.pips i.on {
  background: var(--t-gold);
  box-shadow: 0 0 5px rgba(240, 184, 58, 0.5);
}
.maxed .pips i.on {
  background: var(--t-cyan);
  box-shadow: 0 0 5px rgba(111, 208, 232, 0.5);
}
.ld {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  font-size: 12px;
  color: #aeb8c2;
  white-space: nowrap;
  overflow: hidden;
}
.ld .t-ico {
  font-size: 11px;
  color: var(--t-dim);
}
.ld b {
  color: var(--t-ok);
  font-weight: 600;
}
.lbuy {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
}
.lbuy .t-btn,
.done {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0;
  font-family: var(--t-mono);
  font-size: 14px;
  letter-spacing: 1px;
}
.done {
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-cyan);
}
.lbuy small {
  height: 13px;
  font-size: 10px;
  line-height: 13px;
  text-align: center;
  color: #e0a08f;
  white-space: nowrap;
  overflow: hidden;
}
.mh {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  letter-spacing: 4px;
  color: var(--t-gold-soft);
}
.mh b {
  font-family: var(--t-mono);
  font-size: 18px;
  color: var(--t-gold);
}
.star-h {
  margin-top: 18px;
}
.perks {
  display: grid;
  gap: 5px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--t-muted);
}
.perks li {
  display: flex;
  align-items: center;
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.perks li b {
  flex: none;
  min-width: 28px;
  margin-right: 6px;
  font-family: var(--t-mono);
}
.perks li .sb {
  display: flex;
  gap: 1px;
  min-width: 44px;
  font-size: 12px;
}
.perks li.on {
  color: #f0e2b8;
  border-color: rgba(240, 184, 58, 0.4);
  background: rgba(240, 184, 58, 0.05);
}
@media (max-width: 1500px) {
  .armory {
    grid-template-columns: minmax(0, 1fr) 336px 330px;
  }
  .cls {
    padding: 0 8px 0 10px;
  }
  .ctx b {
    letter-spacing: 0;
  }
  .cells {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    grid-auto-rows: 118px;
  }
  .cell {
    grid-template-rows: 58px 22px 18px;
  }
  .gpic {
    height: 58px;
  }
  .row {
    grid-template-columns: 16px 30px minmax(0, 1fr) 78px 52px;
  }
  .cap {
    padding: 0 14px;
  }
  .cap h3 {
    font-size: 21px;
    letter-spacing: 2px;
  }
  .cap-r {
    grid-template-columns: 124px minmax(0, 1fr);
    gap: 8px;
  }
  .hint {
    display: none;
  }
  .line {
    grid-template-columns: 34px minmax(0, 1fr) 92px;
    gap: 8px;
  }
  .lico {
    width: 34px;
    height: 34px;
    font-size: 18px;
  }
  .ld {
    font-size: 11.5px;
  }
  .ld .now,
  .ld .t-ico {
    display: none;
  }
}
/* 屏幕矮：属性条收紧、不放说明，把高度让给展示台 */
@media (max-height: 880px) {
  .stats > .note,
  .rack-note,
  .tag span {
    display: none;
  }
  .row {
    height: 21px;
  }
  .dps {
    height: 44px;
  }
  .cap {
    height: 96px;
    grid-template-rows: 30px 40px;
    gap: 8px;
  }
  .canvas {
    inset: 0 0 96px;
  }
  .desc {
    display: none;
  }
  .hint,
  .mline {
    bottom: 102px;
  }
}
</style>
