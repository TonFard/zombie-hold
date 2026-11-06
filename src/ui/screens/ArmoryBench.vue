<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BENCH_LINES, BENCH_MAX, BENCH_NAME, benchDesc, benchMods, benchPrice, type BenchLine } from '../../game/data/bench';
import { AMMO_LIMITED, DUAL, WEAPONS, WEAPON_ORDER, effectiveStats, sustainedDps, weightOf, type WeaponKind } from '../../game/data/weapons';
import { benchLevel, bonusesOf, canBench, masteryOf } from '../../game/meta/progress';
import { MASTERY_MAX, MASTERY_PERKS, benchNeeds, masteryProgress, masteryTierCap } from '../../game/data/mastery';
import { STAR_COLOR, STAR_MAX, STAR_TEXT, starXp, starsOf } from '../../game/data/stars';
import { ui } from '../store';

/**
 * 武器台（UI-PLAN 3.3）：左 武器架 / 中 大尺寸 3D 枪模（自动旋转，可拖动、滚轮缩放）/ 右 Tab：属性 · 强化 · 熟练度。
 * 属性用「条 + 数值」；悬停一条强化线时，属性条上多出来的绿色那截就是买了下一级之后的提升
 */
const meta = computed(() => ui.save.meta);
const bonuses = computed(() => bonusesOf(meta.value));
const pick = ref<WeaponKind>('pistol');
const unlocked = (k: WeaponKind) => k === 'pistol' || bonuses.value.weapons.has(k);
type Tab = 'stats' | 'bench' | 'mastery';
const tab = ref<Tab>('stats');
const TABS: Array<{ id: Tab; name: string }> = [
  { id: 'stats', name: '属性' },
  { id: 'bench', name: '强化' },
  { id: 'mastery', name: '熟练度' },
];

/** 一组属性的数值（当前强化等级，或者假设某条线多买一级） */
function statsFor(k: WeaponKind, bench: Record<string, number>) {
  const mods = benchMods(bench)[k];
  const dual = bonuses.value.dual && k === 'pistol';
  const st = effectiveStats(k, 0, mods, dual);
  return { st, dps: sustainedDps(st), weight: weightOf(k, mods, dual), recoil: WEAPONS[k].recoil.v * mods.recoil * (dual ? DUAL.recoil : 1) };
}

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
    dual: bonuses.value.dual && k === 'pistol',
    on: unlocked(k),
    stock: k === 'pistol' ? Infinity : meta.value.ammo[k] ?? 0,
    mastery: { ...p, xp, pct: p.to === null ? 1 : (xp - p.from) / (p.to - p.from), cap: masteryTierCap(p.lv), stars, starTo: sTo, starPct: Math.max(0, Math.min(1, starPct)) },
    lines: BENCH_LINES.map((line: BenchLine) => {
      const lv = benchLevel(meta.value, k, line);
      return { line, name: BENCH_NAME[line], lv, now: benchDesc(k, line, lv), next: lv < BENCH_MAX ? benchDesc(k, line, lv + 1) : '', price: lv < BENCH_MAX ? benchPrice(k, lv) : 0, state: canBench(meta.value, k, line), need: benchNeeds(lv) };
    }),
  };
});

// ---- 属性条：刻度按全部武器的范围定（伤害最高的榴弹 120、射速最高的冲锋枪 13 发/秒……）----
const hoverLine = ref<BenchLine | null>(null);
const cur = computed(() => statsFor(pick.value, meta.value.bench));
const next = computed(() => {
  const line = hoverLine.value;
  if (!line) return null;
  const lv = benchLevel(meta.value, pick.value, line);
  if (lv >= BENCH_MAX) return null;
  return statsFor(pick.value, { ...meta.value.bench, [`${pick.value}.${line}`]: lv + 1 });
});
type S = ReturnType<typeof statsFor>;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const BARS: Array<{ k: string; f: (s: S) => number; v: (s: S) => string; low?: boolean }> = [
  { k: '伤害', f: (s) => clamp((s.st.damage * s.st.pellets) / 130), v: (s) => `${s.st.damage.toFixed(0)}${s.st.pellets > 1 ? ` × ${s.st.pellets}` : ''}` },
  { k: '射速', f: (s) => clamp(s.st.rate / 14), v: (s) => `${s.st.rate.toFixed(1)} 发/秒` },
  { k: '弹匣', f: (s) => clamp(Math.sqrt(s.st.mag / 100)), v: (s) => `${s.st.mag} 发` },
  { k: '换弹', f: (s) => clamp(1 - (s.st.reload - 0.8) / 3.6), v: (s) => `${s.st.reload.toFixed(1)} 秒` },
  { k: '射程', f: (s) => clamp(s.st.range / 60), v: (s) => `${s.st.range} 米` },
  { k: '稳定', f: (s) => clamp(1 - s.recoil / 4.5), v: (s) => `后坐 ${s.recoil.toFixed(1)}°` },
  { k: '重量', f: (s) => clamp(s.weight / 10), v: (s) => `${s.weight.toFixed(1)} kg`, low: true },
];
const bars = computed(() =>
  BARS.map((b) => {
    const a = b.f(cur.value);
    const n = next.value ? b.f(next.value) : a;
    return { k: b.k, pct: a * 100, gain: Math.max(0, n - a) * 100, v: b.v(cur.value), nv: next.value && b.v(next.value) !== b.v(cur.value) ? b.v(next.value) : '', heavy: b.low && cur.value.weight > 5 };
  }),
);
const dpsNext = computed(() => (next.value && Math.abs(next.value.dps - cur.value.dps) > 0.5 ? next.value.dps : null));

// ---- 3D 展示：跟着容器大小走 ----
const stageEl = ref<HTMLDivElement | null>(null);
let preview: ReturnType<typeof ui.gfx.preview> = null;
let ro: ResizeObserver | null = null;
onMounted(() => {
  const el = stageEl.value;
  if (!el) return;
  preview = ui.gfx.preview(Math.max(2, el.clientWidth), Math.max(2, el.clientHeight));
  if (!preview) return;
  el.appendChild(preview.canvas);
  preview.setWeapon(pick.value, 0);
  ro = new ResizeObserver(() => preview?.resize(el.clientWidth, el.clientHeight));
  ro.observe(el);
});
watch(pick, (k) => preview?.setWeapon(k, 0));
onBeforeUnmount(() => {
  ro?.disconnect();
  preview?.dispose();
});
const icon = (k: WeaponKind) => ui.gfx.icon(k);
const stars = (k: WeaponKind) => starsOf(k, meta.value.mastery[k] ?? 0);
</script>

<template>
  <section class="armory t-enter">
    <!-- 左：武器架 -->
    <nav class="rack t-panel" aria-label="武器">
      <div class="t-head">武器 <small>LOADOUT</small></div>
      <button v-for="k in WEAPON_ORDER" :key="k" :class="{ on: pick === k, locked: !unlocked(k) }" :aria-pressed="pick === k" @click="pick = k">
        <img class="ic" :src="icon(k)" alt="" />
        <span class="tx">
          <b>{{ WEAPONS[k].name }}</b>
          <small v-if="!unlocked(k)">🔒 未解锁</small>
          <small v-else class="mlv" :class="{ max: masteryOf(meta, k) >= MASTERY_MAX }">
            熟练 {{ masteryOf(meta, k) }}/{{ MASTERY_MAX }}<i v-if="stars(k)" :style="{ color: STAR_COLOR[stars(k)] }"> {{ '★'.repeat(stars(k)) }}</i>
          </small>
        </span>
      </button>
    </nav>

    <!-- 中：枪模展示 -->
    <div class="stage">
      <div class="halo" aria-hidden="true"></div>
      <div ref="stageEl" class="canvas" title="拖动旋转 · 滚轮缩放" aria-label="武器 3D 展示"></div>
      <div class="cap">
        <div class="name">
          <h3>{{ w.def.name }}<em v-if="w.dual">双持</em></h3>
          <span v-if="!w.on" class="lock">🔒 未解锁 · 在军械库解锁</span>
        </div>
        <p class="role">{{ w.def.role }}</p>
        <div class="badges">
          <span class="star" :style="{ color: STAR_COLOR[w.mastery.stars] }">{{ w.mastery.stars ? '★'.repeat(w.mastery.stars) : '☆' }}<small>{{ w.mastery.stars }}/{{ STAR_MAX }}</small></span>
          <span class="ml">熟练度 <b>{{ w.mastery.lv }}</b>/{{ MASTERY_MAX }}</span>
          <span class="mbar"><i :style="{ width: `${Math.round(w.mastery.pct * 100)}%` }"></i></span>
        </div>
      </div>
      <p class="hint">拖动旋转 · 滚轮缩放</p>
    </div>

    <!-- 右：信息 Tab -->
    <aside class="info t-panel">
      <div class="tabs t-seg" role="tablist">
        <button v-for="t in TABS" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.name }}</button>
      </div>

      <!-- 属性 -->
      <div v-if="tab === 'stats'" class="pane" role="tabpanel">
        <div class="dps">
          <span>持续 DPS<small>（1 级）</small></span>
          <b>{{ cur.dps.toFixed(0) }}</b>
          <em v-if="dpsNext !== null">→ {{ dpsNext.toFixed(0) }}</em>
        </div>
        <div class="bars">
          <div v-for="b in bars" :key="b.k" class="t-stat">
            <span>{{ b.k }}</span>
            <i><b :style="{ width: b.pct + '%', ...(b.heavy ? { background: '#e8a03f' } : {}) }"></b><s v-if="b.gain > 0" :style="{ left: b.pct + '%', width: b.gain + '%' }"></s></i>
            <em>{{ b.v }}<template v-if="b.nv"><br /><span class="to">→ {{ b.nv }}</span></template></em>
          </div>
        </div>
        <p class="note">超过 3 kg 每千克移速 −3%、冲刺更耗体力；越重换弹、举镜、切枪越慢。背着的另一把算一半重量。</p>
        <div class="ammo">
          <span>弹药库存</span>
          <b v-if="w.k === 'pistol' || !AMMO_LIMITED">∞</b>
          <b v-else>{{ w.stock }}<small> 发</small></b>
        </div>
        <div v-if="AMMO_LIMITED && w.k !== 'pistol'" class="buy">
          <button class="t-btn gold" :disabled="!w.on || meta.supplies < (w.def.ammo?.price ?? 0)" @click="ui.actions.buyAmmo(w.k, 1)">+{{ w.def.ammo?.pack }} 发 · ▣ {{ w.def.ammo?.price }}</button>
          <button class="t-btn gold" :disabled="!w.on || meta.supplies < (w.def.ammo?.price ?? 0) * 5" @click="ui.actions.buyAmmo(w.k, 5)">+{{ (w.def.ammo?.pack ?? 0) * 5 }} 发 · ▣ {{ (w.def.ammo?.price ?? 0) * 5 }}</button>
        </div>
        <p v-else-if="w.k !== 'pistol'" class="note">目前所有武器子弹无限。</p>
      </div>

      <!-- 强化 -->
      <div v-else-if="tab === 'bench'" class="pane" role="tabpanel">
        <p class="note top">永久生效，每局都带着；每一级要先练到对应熟练度。悬停一条线会显示买了之后 DPS 的变化。</p>
        <div v-for="l in w.lines" :key="l.line" class="line" :class="{ maxed: l.state === 'maxed' }" @mouseenter="hoverLine = l.line" @mouseleave="hoverLine = null" @focusin="hoverLine = l.line" @focusout="hoverLine = null">
          <div class="lh">
            <b>{{ l.name }}</b>
            <span class="pips"><i v-for="i in BENCH_MAX" :key="i" :class="{ on: i <= l.lv }"></i></span>
          </div>
          <div class="ld">{{ l.lv > 0 ? l.now : '未强化' }}<template v-if="l.next"> → <b>{{ l.next }}</b></template></div>
          <div v-if="hoverLine === l.line && dpsNext !== null" class="ld gain">DPS {{ cur.dps.toFixed(0) }} → <b>{{ dpsNext.toFixed(0) }}</b></div>
          <button v-if="l.state !== 'maxed'" class="t-btn gold" :disabled="l.state !== 'ok'" @click="ui.actions.buyBench(w.k, l.line)">
            ▣ {{ l.price }}<template v-if="l.state === 'locked'"> · 先在军械库解锁</template><template v-else-if="l.state === 'mastery'"> · 需要熟练度 {{ l.need }}</template>
          </button>
          <div v-else class="done">已满级</div>
        </div>
      </div>

      <!-- 熟练度与升星 -->
      <div v-else class="pane" role="tabpanel">
        <div class="mh"><span>熟练度</span><b>{{ w.mastery.lv }} / {{ MASTERY_MAX }}</b></div>
        <div class="mbar big"><i :style="{ width: `${Math.round(w.mastery.pct * 100)}%` }"></i></div>
        <p class="note">{{ w.mastery.to === null ? `已精通（${w.mastery.xp} 经验）` : `${w.mastery.xp} / ${w.mastery.to} 经验` }} · 用它击杀 +1，爆头击杀再 +1 · 局内工坊最高 {{ w.mastery.cap }} 级</p>
        <ol class="perks">
          <li v-for="(t, i) in MASTERY_PERKS" :key="i" :class="{ on: w.mastery.lv > i }"><b>{{ i + 1 }}</b>{{ t }}</li>
        </ol>
        <div class="mh star-h"><span>升星</span><b :style="{ color: STAR_COLOR[w.mastery.stars] }">{{ w.mastery.stars ? '★'.repeat(w.mastery.stars) : '—' }}</b></div>
        <template v-if="w.mastery.lv >= MASTERY_MAX">
          <div class="mbar big"><i :style="{ width: `${Math.round(w.mastery.starPct * 100)}%`, background: STAR_COLOR[Math.min(STAR_MAX, w.mastery.stars + 1)] }"></i></div>
          <p class="note">{{ w.mastery.starTo === null ? '已满星' : `${w.mastery.xp} / ${w.mastery.starTo} 经验到下一颗星` }}</p>
        </template>
        <p v-else class="note">精通（熟练度 {{ MASTERY_MAX }}）之后继续用它杀怪，每颗星一个特性（出征时生效）</p>
        <ol class="perks">
          <li v-for="(t, i) in STAR_TEXT[w.k]" :key="i" :class="{ on: w.mastery.stars > i }" :style="w.mastery.stars > i ? { borderColor: STAR_COLOR[i + 1], color: STAR_COLOR[i + 1] } : undefined"><b>{{ '★'.repeat(i + 1) }}</b>{{ t }}</li>
        </ol>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.armory {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr) 360px;
  gap: 18px;
  height: 100%;
  min-height: 0;
}
.rack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 12px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.rack button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--t-line);
  border-left: 3px solid transparent;
  color: var(--t-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.15s var(--t-ease);
}
.rack button:hover,
.rack button:focus-visible {
  outline: none;
  border-color: var(--t-line-strong);
  background: rgba(255, 255, 255, 0.05);
}
.rack button.on {
  border-color: rgba(240, 184, 58, 0.5);
  border-left-color: var(--t-gold);
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.12), rgba(240, 184, 58, 0.02));
}
.rack button.locked {
  opacity: 0.5;
}
.ic {
  width: 64px;
  height: 26px;
  flex: none;
  object-fit: contain;
  /* 枪模是深色金属：底下垫一点亮，放在深色列表上才看得清 */
  background: radial-gradient(ellipse at center, rgba(200, 210, 220, 0.2), transparent 70%);
  filter: brightness(1.6) contrast(1.1);
}
.locked .ic {
  filter: grayscale(1) brightness(0.6);
}
.tx {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tx b {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx small {
  font-size: 11px;
  color: var(--t-muted);
}
.tx small i {
  font-style: normal;
}
.mlv.max {
  color: var(--t-gold);
}
/* ---- 中间展示台 ---- */
.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--t-line);
  background: linear-gradient(180deg, rgba(8, 12, 18, 0.35), rgba(8, 12, 18, 0.7));
  overflow: hidden;
}
/* 展示台：中心一圈蓝绿的光 + 地面的椭圆光斑 + 细网格 */
.halo {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 55% 40% at 50% 48%, rgba(111, 208, 232, 0.13), transparent 70%),
    radial-gradient(ellipse 38% 7% at 50% 74%, rgba(240, 184, 58, 0.16), transparent 70%),
    linear-gradient(rgba(111, 208, 232, 0.05) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, rgba(111, 208, 232, 0.05) 1px, transparent 1px) 0 0 / 40px 40px;
  pointer-events: none;
}
.canvas {
  position: absolute;
  inset: 0 0 110px;
}
.canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.cap {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 18px;
  pointer-events: none;
}
.name {
  display: flex;
  align-items: baseline;
  gap: 14px;
}
.name h3 {
  font-size: 30px;
  letter-spacing: 6px;
  color: #eef1f3;
}
.name h3 em {
  margin-left: 10px;
  padding: 1px 8px;
  vertical-align: middle;
  font-style: normal;
  font-size: 12px;
  letter-spacing: 2px;
  color: #0b0f14;
  background: var(--t-gold);
}
.lock {
  font-size: 13px;
  color: var(--t-muted);
}
.role {
  margin-top: 4px;
  font-size: 13px;
  color: var(--t-cyan);
}
.badges {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--t-muted);
}
.star {
  font-size: 18px;
  letter-spacing: 2px;
}
.star small {
  margin-left: 6px;
  font-family: var(--t-mono);
  font-size: 11px;
  color: var(--t-dim);
}
.ml b {
  font-family: var(--t-mono);
  font-size: 15px;
  color: var(--t-gold);
}
.mbar {
  flex: 1;
  max-width: 260px;
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
.hint {
  position: absolute;
  top: 12px;
  right: 16px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--t-dim);
  pointer-events: none;
}
/* ---- 右侧信息 ---- */
.info {
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  min-height: 0;
}
.tabs {
  flex: none;
  margin-bottom: 14px;
}
.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
}
.dps {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--t-line);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.dps small {
  letter-spacing: 0;
  color: var(--t-dim);
}
.dps b {
  margin-left: auto;
  font-family: var(--t-mono);
  font-size: 34px;
  font-weight: 600;
  color: var(--t-gold);
}
.dps em {
  font-style: normal;
  font-family: var(--t-mono);
  font-size: 18px;
  color: var(--t-ok);
}
.bars {
  display: grid;
  gap: 11px;
}
.bars .t-stat {
  grid-template-columns: 40px 1fr 96px;
}
.to {
  color: var(--t-ok);
  font-size: 12px;
}
.note {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--t-dim);
}
.note.top {
  margin: 0 0 10px;
}
.ammo {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--t-line);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.ammo b {
  font-family: var(--t-mono);
  font-size: 24px;
  color: var(--t-text);
}
.ammo small {
  font-size: 12px;
  color: var(--t-muted);
}
.buy {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.buy .t-btn {
  padding: 7px 12px;
  font-size: 12px;
  letter-spacing: 1px;
}
.line {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--t-line);
  border-left: 2px solid rgba(240, 184, 58, 0.3);
  transition: border-color 0.15s var(--t-ease);
}
.line:hover,
.line:focus-within {
  border-color: rgba(240, 184, 58, 0.45);
}
.line.maxed {
  border-left-color: var(--t-cyan);
}
.lh {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  letter-spacing: 2px;
}
.pips {
  display: flex;
  gap: 3px;
}
.pips i {
  width: 14px;
  height: 5px;
  background: rgba(255, 255, 255, 0.15);
}
.pips i.on {
  background: var(--t-gold);
  box-shadow: 0 0 5px rgba(240, 184, 58, 0.5);
}
.ld {
  font-size: 12px;
  line-height: 1.5;
  color: #aeb8c2;
}
.ld b {
  color: #eef1f3;
  font-weight: 600;
}
.ld.gain b {
  color: var(--t-ok);
}
.line .t-btn {
  align-self: flex-start;
  padding: 6px 14px;
  font-size: 13px;
  letter-spacing: 1px;
}
.done {
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--t-cyan);
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
  margin-top: 20px;
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
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.perks li b {
  display: inline-block;
  min-width: 28px;
  margin-right: 6px;
  font-family: var(--t-mono);
}
.perks li.on {
  color: #f0e2b8;
  border-color: rgba(240, 184, 58, 0.4);
  background: rgba(240, 184, 58, 0.05);
}
@media (max-width: 1360px) {
  .armory {
    grid-template-columns: 200px minmax(0, 1fr) 320px;
  }
  .ic {
    display: none;
  }
}
</style>
