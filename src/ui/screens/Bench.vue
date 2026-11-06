<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../hud';
import { ui } from '../store';
import { MAX_TIER as maxTier } from '../../game/data/weapons';

const best = computed(() => Math.max(0, ...hud.weapons.filter((w) => w.owned).map((w) => w.dps)));
</script>

<template>
  <div v-if="ui.screen === 'bench'" class="bench">
    <div class="panel t-panel t-enter">
      <div class="head">
        <h2>武器工坊 <small>FIELD WORKSHOP</small></h2>
        <div class="scrap"><span class="d">◆</span>{{ hud.scrap }}<small>零件</small></div>
      </div>

      <div v-if="hud.risk.id && hud.risk.stage === 0" class="risk" role="region" aria-label="风险事件">
        <div class="rh"><b><i aria-hidden="true">!</i>事件 · {{ hud.risk.name }}</b><span>风险换收益，可以不接</span></div>
        <div class="rl"><span class="c">代价</span>{{ hud.risk.cost }}</div>
        <div class="rl"><span class="r">奖励</span>{{ hud.risk.reward }}</div>
        <button type="button" :disabled="!hud.risk.canAfford" @click="ui.actions.acceptRisk()">{{ hud.risk.canAfford ? '接下' : '零件不够' }}</button>
      </div>
      <div v-else-if="hud.risk.id && hud.risk.stage === 1" class="risk on">
        <div class="rh"><b>事件 · {{ hud.risk.name }}</b><span>进行中</span></div>
        <div class="rl"><span class="r">奖励</span>{{ hud.risk.reward }}</div>
      </div>
      <div v-if="hud.risk.free" class="risk on"><div class="rh"><b>黑市</b><span>下一次升级免费</span></div></div>

      <div class="rows">
        <div v-for="w in hud.weapons" :key="w.kind" class="row" :class="{ own: w.owned, eq: w.equipped }">
          <div class="id">
            <div class="key">{{ w.key }}</div>
            <div>
              <div class="name">{{ w.name }}<em v-if="w.equipped">使用中</em></div>
              <div class="tags">
                <span class="tag info">{{ w.weight.toFixed(1) }} kg</span>
                <span v-if="w.reserve >= 0" class="tag info" :class="{ out: w.reserve === 0 }">备弹 {{ w.reserve }}</span>
                <span v-for="t in w.specials" :key="t" class="tag">{{ t }}</span>
              </div>
            </div>
          </div>

          <div class="pips">
            <i v-for="i in maxTier" :key="i" :class="{ on: w.owned && i <= w.tier, cap: i > w.cap }"></i>
          </div>

          <div class="dps">
            <div class="n">{{ w.dps.toFixed(0) }}</div>
            <div class="l">DPS</div>
          </div>

          <div class="act">
            <div class="line">
              <template v-if="w.locked">
                <div class="maxed off">{{ w.lockNote }}</div>
              </template>
              <template v-else-if="!w.owned">
                <button class="buy" :disabled="!w.canBuy" @click="ui.actions.buy(w.kind)"><span class="d">◆</span>{{ w.price }} 购买</button>
                <span v-if="w.short > 0" class="short">差 {{ w.short }}</span>
                <span v-else-if="w.swapOut" class="short">替换 {{ w.swapOut }}</span>
              </template>
              <template v-else-if="w.nextName">
                <button class="up" :disabled="!w.canUpgrade" @click="ui.actions.upgrade(w.kind)"><span class="d">◆</span>{{ w.nextCost }} 升级：{{ w.nextName }}</button>
              </template>
              <template v-else>
                <div class="maxed">{{ w.tier < maxTier ? `已到上限 ${w.cap} 级（大厅 · 军械库可提高）` : '已升满' }}</div>
              </template>
              <button v-if="w.owned && !w.equipped" class="eq-btn" :title="w.stowed && w.swapOut ? `${w.swapOut} 放回工坊` : ''" @click="ui.actions.equip(w.kind)">{{ w.stowed ? '取出' : '装备' }}</button>
              <span v-if="w.stowed && w.swapOut" class="short">替换 {{ w.swapOut }}</span>
            </div>
            <div v-if="!w.owned && !w.locked" class="hint">1 级 DPS <b>{{ w.dpsAfter.toFixed(0) }}</b><template v-if="w.dpsAfter > best"> ▲</template></div>
            <div v-else-if="w.nextName" class="hint">{{ w.nextDesc }}（DPS {{ w.dps.toFixed(0) }} → <b>{{ w.dpsAfter.toFixed(0) }}</b>）</div>
          </div>
        </div>
      </div>

      <div class="foot">
        <span>随身 2 把 · 滚轮切换</span>
        <button class="t-btn close" @click="ui.actions.closeBench()">关闭（E / Esc）</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 局内工坊：保持紧凑一栏（战斗间隙快速操作），换成「指挥终端」的面板、角标、金色进度 */
.bench {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(3, 5, 8, 0.66);
  backdrop-filter: blur(4px);
}
.panel {
  width: min(980px, 94vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 20px 24px 16px;
  background: var(--t-panel-strong);
  box-shadow: 0 0 80px rgba(0, 0, 0, 0.85);
  color: var(--t-text);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 10px;
  margin-bottom: 14px;
  border-bottom: 1px solid transparent;
  border-image: linear-gradient(90deg, rgba(240, 184, 58, 0.55), transparent 80%) 1;
}
h2 {
  font-size: 18px;
  letter-spacing: 8px;
  color: var(--t-gold-soft);
  font-weight: 500;
}
h2 small {
  margin-left: 10px;
  font-family: var(--t-mono);
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--t-dim);
  font-weight: 400;
}
.scrap {
  font-family: var(--t-mono);
  font-size: 28px;
  font-weight: 700;
  color: #f3e9cf;
  font-variant-numeric: tabular-nums;
}
.scrap small {
  margin-left: 8px;
  font-family: var(--hud-font);
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--t-muted);
  font-weight: 400;
}
.d {
  color: var(--t-gold);
  font-size: 0.7em;
  margin-right: 6px;
}
/* ---- 风险事件：醒目的警示条 ---- */
.risk {
  position: relative;
  margin: 0 0 12px;
  padding: 10px 14px 10px 18px;
  border: 1px solid rgba(240, 184, 58, 0.55);
  background: repeating-linear-gradient(135deg, rgba(240, 184, 58, 0.09) 0 10px, rgba(240, 184, 58, 0.03) 10px 20px);
  box-shadow: 0 0 22px rgba(240, 184, 58, 0.12);
  font-size: 13px;
}
.risk::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--t-gold);
}
.risk.on {
  border-color: rgba(111, 208, 232, 0.45);
  background: rgba(111, 208, 232, 0.05);
  box-shadow: none;
}
.risk.on::before {
  background: var(--t-cyan);
}
.rh {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.rh b {
  color: var(--t-gold);
  letter-spacing: 2px;
}
.rh b i {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin-right: 8px;
  line-height: 18px;
  text-align: center;
  font-style: normal;
  color: #0b0f14;
  background: var(--t-gold);
}
.risk.on .rh b {
  color: var(--t-cyan);
}
.rh span {
  color: var(--t-muted);
  font-size: 12px;
}
.rl {
  padding: 2px 0;
  color: #c8d0d8;
}
.rl span {
  display: inline-block;
  width: 40px;
  font-size: 12px;
}
.rl .c {
  color: var(--t-red);
}
.rl .r {
  color: var(--t-ok);
}
.risk button {
  margin-top: 8px;
  padding: 5px 20px;
  background: transparent;
  border: 1px solid var(--t-gold);
  color: var(--t-gold);
  font: inherit;
  letter-spacing: 3px;
  cursor: pointer;
}
.risk button:hover:not(:disabled),
.risk button:focus-visible {
  background: var(--t-gold);
  color: #0b0f14;
  outline: none;
}
.risk button:disabled {
  opacity: 0.5;
  cursor: default;
}
/* ---- 武器行 ---- */
.rows {
  display: grid;
  gap: 6px;
}
.row {
  display: grid;
  grid-template-columns: 250px 120px 70px 1fr;
  align-items: center;
  gap: 16px;
  padding: 11px 16px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--t-line);
  border-left: 3px solid rgba(255, 255, 255, 0.12);
  opacity: 0.8;
  transition: border-color 0.15s var(--t-ease), background 0.15s var(--t-ease);
}
.row:hover {
  border-color: var(--t-line-strong);
}
.row.own {
  opacity: 1;
  border-left-color: rgba(111, 208, 232, 0.7);
}
.row.eq {
  border-left-color: var(--t-gold);
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.09), rgba(240, 184, 58, 0.02) 60%);
}
.id {
  display: flex;
  gap: 12px;
  align-items: center;
}
.key {
  width: 24px;
  height: 24px;
  line-height: 24px;
  text-align: center;
  font-family: var(--t-mono);
  font-size: 12px;
  color: var(--t-muted);
  border: 1px solid var(--t-line-strong);
}
.eq .key {
  color: var(--t-gold);
  border-color: var(--t-gold);
}
.name {
  font-size: 15px;
  letter-spacing: 2px;
  color: #f1ead6;
}
.name em {
  font-style: normal;
  margin-left: 10px;
  padding: 0 5px;
  font-size: 10px;
  letter-spacing: 1px;
  color: #0b0f14;
  background: var(--t-gold);
}
.tags {
  margin-top: 4px;
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.tag {
  font-size: 10px;
  padding: 1px 6px;
  color: var(--t-cyan);
  border: 1px solid rgba(111, 208, 232, 0.4);
}
.tag.info {
  color: #a9b8c8;
  border-color: rgba(255, 255, 255, 0.18);
}
.tag.out {
  color: #ff7a62;
  border-color: rgba(255, 122, 98, 0.5);
}
/* 等级：金色圆点；超过熟练度上限的用斜纹 */
.pips {
  display: flex;
  gap: 5px;
}
.pips i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.pips i.cap {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.1);
}
.pips i.on {
  background: var(--t-gold);
  border-color: var(--t-gold);
  box-shadow: 0 0 6px rgba(240, 184, 58, 0.6);
}
.dps .n {
  font-family: var(--t-mono);
  font-size: 24px;
  font-weight: 700;
  color: #f3e9cf;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.dps .l {
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--t-dim);
}
.act {
  display: grid;
  gap: 4px;
  justify-items: start;
}
button {
  font-family: inherit;
  cursor: pointer;
  transition: 0.15s var(--t-ease);
}
button.buy,
button.up {
  padding: 7px 16px;
  background: rgba(240, 184, 58, 0.06);
  border: 1px solid var(--t-gold);
  color: var(--t-gold);
  font-size: 13px;
  letter-spacing: 2px;
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%);
}
button.buy:hover:not(:disabled),
button.up:hover:not(:disabled),
button.buy:focus-visible,
button.up:focus-visible {
  outline: none;
  background: var(--t-gold);
  color: #0b0f14;
}
button.buy:hover:not(:disabled) .d,
button.up:hover:not(:disabled) .d {
  color: #0b0f14;
}
button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.hint {
  font-size: 12px;
  color: var(--t-muted);
}
.hint b {
  color: var(--t-ok);
}
.maxed {
  font-size: 13px;
  letter-spacing: 4px;
  color: var(--t-cyan);
}
.maxed.off {
  letter-spacing: 2px;
  color: var(--t-dim);
}
.short {
  font-size: 12px;
  color: #e0a050;
  letter-spacing: 1px;
}
.line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.eq-btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--t-line-strong);
  color: #a9b8c8;
  font-size: 12px;
}
.eq-btn:hover,
.eq-btn:focus-visible {
  outline: none;
  border-color: var(--t-cyan);
  color: #fff;
}
.foot {
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--t-dim);
}
.close {
  padding: 7px 20px;
  font-size: 13px;
  letter-spacing: 3px;
}
</style>
