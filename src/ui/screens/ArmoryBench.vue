<script setup lang="ts">
import { computed, ref } from 'vue';
import { BENCH_LINES, BENCH_MAX, BENCH_NAME, benchDesc, benchMods, benchPrice, type BenchLine } from '../../game/data/bench';
import { AMMO_LIMITED, DUAL, WEAPONS, WEAPON_ORDER, effectiveStats, sustainedDps, weightOf, type WeaponKind } from '../../game/data/weapons';
import { benchLevel, bonusesOf, canBench } from '../../game/meta/progress';
import { ui } from '../store';

/** 武器工作台：每把枪一张台子——属性、库存子弹、四条永久强化线 */
const meta = computed(() => ui.save.meta);
const bonuses = computed(() => bonusesOf(meta.value));
const pick = ref<WeaponKind>('pistol');
const unlocked = (k: WeaponKind) => k === 'pistol' || bonuses.value.weapons.has(k);

const w = computed(() => {
  const k = pick.value;
  const def = WEAPONS[k];
  const mods = benchMods(meta.value.bench)[k];
  const dual = bonuses.value.dual && k === 'pistol';
  const st = effectiveStats(k, 0, mods, dual);
  const raw = effectiveStats(k, 0);
  return {
    k,
    def,
    dual,
    on: unlocked(k),
    weight: weightOf(k, mods, dual),
    rawWeight: def.weight,
    recoil: def.recoil.v * mods.recoil * (dual ? DUAL.recoil : 1),
    rows: [
      { k: '伤害', v: `${st.damage.toFixed(0)}${st.pellets > 1 ? ` × ${st.pellets}` : ''}`, up: st.damage > raw.damage },
      { k: '射速', v: `${st.rate.toFixed(1)} 发/秒`, up: st.rate > raw.rate },
      { k: '弹匣', v: `${st.mag} 发`, up: st.mag > raw.mag },
      { k: '换弹', v: `${st.reload.toFixed(1)} 秒` },
      { k: '射程', v: `${st.range} 米` },
      { k: 'DPS（1 级）', v: sustainedDps(st).toFixed(0) },
    ],
    stock: k === 'pistol' ? Infinity : meta.value.ammo[k] ?? 0,
    lines: BENCH_LINES.map((line: BenchLine) => {
      const lv = benchLevel(meta.value, k, line);
      return { line, name: BENCH_NAME[line], lv, now: benchDesc(k, line, lv), next: lv < BENCH_MAX ? benchDesc(k, line, lv + 1) : '', price: lv < BENCH_MAX ? benchPrice(k, lv) : 0, state: canBench(meta.value, k, line) };
    }),
  };
});
/** 重量条：0–10 千克 */
const wPct = (kg: number) => Math.min(100, kg * 10);
/** 后坐力条：0–5 度 */
const rPct = (v: number) => Math.min(100, (v / 4.5) * 100);
</script>

<template>
  <section class="armory">
    <!-- 左：武器架 -->
    <nav class="rack" aria-label="武器">
      <button v-for="k in WEAPON_ORDER" :key="k" :class="{ on: pick === k, locked: !unlocked(k) }" @click="pick = k">
        <b>{{ WEAPONS[k].name }}</b>
        <small v-if="!unlocked(k)">未解锁</small>
        <small v-else-if="k === 'pistol' || !AMMO_LIMITED">∞</small>
        <small v-else>{{ meta.ammo[k] ?? 0 }} 发</small>
      </button>
    </nav>

    <!-- 右：这把枪的工作台 -->
    <div class="bench">
      <header>
        <h3>{{ w.def.name }}<em v-if="w.dual">双持</em></h3>
        <p class="role">{{ w.def.role }}</p>
      </header>

      <div class="grid">
        <div class="stats">
          <dl>
            <template v-for="r in w.rows" :key="r.k">
              <dt>{{ r.k }}</dt>
              <dd :class="{ up: r.up }">{{ r.v }}</dd>
            </template>
          </dl>
          <div class="meter">
            <span>重量</span>
            <i><b :style="{ width: wPct(w.weight) + '%' }" :class="{ heavy: w.weight > 5 }"></b></i>
            <em>{{ w.weight.toFixed(1) }} kg</em>
          </div>
          <div class="meter">
            <span>后坐</span>
            <i><b :style="{ width: rPct(w.recoil) + '%' }"></b></i>
            <em>{{ w.recoil.toFixed(1) }}°</em>
          </div>
          <p class="note">超过 3 kg 每千克移速 −3%、冲刺更耗体力；越重换弹、举镜、切枪越慢。背着的另一把算一半重量。</p>
        </div>

        <div class="ammo">
          <h4>弹药库存</h4>
          <div v-if="w.k === 'pistol' || !AMMO_LIMITED" class="big">∞</div>
          <p v-if="!AMMO_LIMITED && w.k !== 'pistol'" class="note">目前所有武器子弹无限。</p>
          <template v-if="AMMO_LIMITED && w.k !== 'pistol'">
            <div class="big">{{ w.stock }}<small> 发</small></div>
            <div class="buy">
              <button :disabled="!w.on || meta.supplies < (w.def.ammo?.price ?? 0)" @click="ui.actions.buyAmmo(w.k, 1)">+{{ w.def.ammo?.pack }} 发<small>▣ {{ w.def.ammo?.price }}</small></button>
              <button :disabled="!w.on || meta.supplies < (w.def.ammo?.price ?? 0) * 5" @click="ui.actions.buyAmmo(w.k, 5)">+{{ (w.def.ammo?.pack ?? 0) * 5 }} 发<small>▣ {{ (w.def.ammo?.price ?? 0) * 5 }}</small></button>
            </div>
            <p class="note">出征时全部带上，打剩的退回库存。打光了只能换手枪。</p>
          </template>
        </div>
      </div>

      <h4 class="ups">工作台强化 <small>永久生效，每局都带着</small></h4>
      <div class="lines">
        <div v-for="l in w.lines" :key="l.line" class="line" :class="{ maxed: l.state === 'maxed' }">
          <div class="lh">
            <b>{{ l.name }}</b>
            <span class="pips"><i v-for="i in BENCH_MAX" :key="i" :class="{ on: i <= l.lv }"></i></span>
          </div>
          <div class="ld">{{ l.lv > 0 ? l.now : '—' }}<template v-if="l.next"> → <b>{{ l.next }}</b></template></div>
          <button v-if="l.state !== 'maxed'" :disabled="l.state !== 'ok'" @click="ui.actions.buyBench(w.k, l.line)">
            ▣ {{ l.price }}<template v-if="l.state === 'locked'"> · 先在军械库解锁</template>
          </button>
          <div v-else class="done">已满级</div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.armory {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 18px;
  min-height: 0;
}
.rack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rack button {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 12px;
  background: rgba(10, 14, 18, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 3px solid transparent;
  color: #d8dee4;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.rack button b {
  font-weight: 600;
}
.rack button small {
  font-size: 12px;
  color: #8f9aa6;
}
.rack button.on {
  border-left-color: #f0b83a;
  background: rgba(240, 184, 58, 0.08);
}
.rack button.locked {
  opacity: 0.5;
}
.rack button:hover,
.rack button:focus-visible {
  border-color: rgba(111, 208, 232, 0.5);
  outline: none;
}
.bench {
  padding: 18px 22px;
  background: rgba(10, 14, 18, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.08);
  min-width: 0;
}
header {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 14px;
}
h3 {
  font-size: 20px;
  letter-spacing: 3px;
  color: #eef1f3;
}
h3 em {
  margin-left: 10px;
  padding: 1px 8px;
  font-style: normal;
  font-size: 12px;
  color: #0b0f14;
  background: #f0b83a;
}
.role {
  font-size: 13px;
  color: #6fd0e8;
}
.grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 24px;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  row-gap: 6px;
  column-gap: 14px;
  font-size: 14px;
}
dt {
  color: #8f9aa6;
}
dd {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
dd.up {
  color: #7ad04a;
}
.meter {
  display: grid;
  grid-template-columns: 40px 1fr 56px;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 13px;
  color: #8f9aa6;
}
.meter i {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
}
.meter b {
  display: block;
  height: 100%;
  background: #a9b8c8;
}
.meter b.heavy {
  background: #e8a03f;
}
.meter em {
  font-style: normal;
  text-align: right;
  color: #d8dee4;
}
.note {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #6f7c88;
}
h4 {
  font-size: 13px;
  letter-spacing: 4px;
  color: #d9c9a0;
  margin-bottom: 8px;
}
h4 small {
  margin-left: 8px;
  letter-spacing: 1px;
  font-size: 12px;
  color: #6f7c88;
}
.big {
  font-size: 36px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.big small {
  font-size: 14px;
  color: #8f9aa6;
}
.buy {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
button {
  font: inherit;
}
.buy button,
.line button {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 14px;
  background: transparent;
  border: 1px solid #f0b83a;
  color: #f0b83a;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.buy button small {
  font-size: 12px;
  opacity: 0.8;
}
.buy button:hover:not(:disabled),
.line button:hover:not(:disabled) {
  background: #f0b83a;
  color: #0b0f14;
}
.buy button:disabled,
.line button:disabled {
  border-color: rgba(255, 255, 255, 0.18);
  color: #6f7c88;
  cursor: not-allowed;
}
.ups {
  margin-top: 22px;
}
.lines {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.line {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 118px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.line.maxed {
  border-color: rgba(111, 208, 232, 0.35);
}
.lh {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.pips {
  display: flex;
  gap: 3px;
}
.pips i {
  width: 12px;
  height: 5px;
  background: rgba(255, 255, 255, 0.15);
}
.pips i.on {
  background: #f0b83a;
}
.ld {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: #aeb8c2;
}
.ld b {
  color: #eef1f3;
  font-weight: 600;
}
.line button {
  align-self: flex-start;
}
.done {
  font-size: 12px;
  letter-spacing: 3px;
  color: #6fd0e8;
  line-height: 31px;
}
@media (max-width: 1100px) {
  .lines {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
