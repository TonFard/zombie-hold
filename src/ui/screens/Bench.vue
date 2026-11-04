<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../hud';
import { ui } from '../store';
import { MAX_TIER as maxTier } from '../../game/data/weapons';

const best = computed(() => Math.max(0, ...hud.weapons.filter((w) => w.owned).map((w) => w.dps)));
</script>

<template>
  <div v-if="ui.screen === 'bench'" class="bench">
    <div class="panel">
      <div class="head">
        <h2>武 器 工 坊</h2>
        <div class="scrap"><span class="d">◆</span>{{ hud.scrap }}<small>零件</small></div>
      </div>

      <div class="rows">
        <div v-for="w in hud.weapons" :key="w.kind" class="row" :class="{ own: w.owned, eq: w.equipped }">
          <div class="id">
            <div class="key">{{ w.key }}</div>
            <div>
              <div class="name">{{ w.name }}<em v-if="w.equipped">使用中</em></div>
              <div class="tags">
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
                <span v-if="w.short > 0" class="short">已解锁 · 零件还差 {{ w.short }}</span>
                <span v-else-if="w.swapOut" class="short">最多带两把 · 会换掉手里的{{ w.swapOut }}</span>
              </template>
              <template v-else-if="w.nextName">
                <button class="up" :disabled="!w.canUpgrade" @click="ui.actions.upgrade(w.kind)"><span class="d">◆</span>{{ w.nextCost }} 升级：{{ w.nextName }}</button>
              </template>
              <template v-else>
                <div class="maxed">{{ w.tier < maxTier ? `已到上限 ${w.cap} 级（大厅 · 军械库可提高）` : '已升满' }}</div>
              </template>
              <button v-if="w.owned && !w.equipped" class="eq-btn" @click="ui.actions.equip(w.kind)">装备</button>
            </div>
            <div v-if="!w.owned && !w.locked" class="hint">买下后升到 1 级可达 <b>{{ w.dpsAfter.toFixed(0) }}</b> DPS<template v-if="w.dpsAfter > best">，超过现有的最强 {{ best.toFixed(0) }}</template></div>
            <div v-else-if="w.nextName" class="hint">{{ w.nextDesc }}（DPS {{ w.dps.toFixed(0) }} → <b>{{ w.dpsAfter.toFixed(0) }}</b>）</div>
          </div>
        </div>
      </div>

      <div class="foot">
        <span>最多随身带两把枪，滚轮或 1 / 2 切换；买第三把会换掉手里那把（等级清零）。</span>
        <button class="close" @click="ui.actions.closeBench()">关闭（E / Esc）</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bench {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(3, 5, 8, 0.72);
  backdrop-filter: blur(4px);
}
.panel {
  width: min(980px, 94vw);
  background: linear-gradient(180deg, #121920, #0b0f14);
  border: 1px solid #243240;
  box-shadow: 0 0 80px rgba(0, 0, 0, 0.9);
  padding: 22px 26px 18px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
}
h2 {
  font-size: 18px;
  letter-spacing: 14px;
  color: #d9c9a0;
  font-weight: 400;
}
.scrap {
  font-size: 28px;
  font-weight: 700;
  color: #f3e9cf;
}
.scrap small {
  margin-left: 8px;
  font-size: 12px;
  letter-spacing: 3px;
  color: #7e8a96;
  font-weight: 400;
}
.d {
  color: #f0b83a;
  font-size: 0.7em;
  margin-right: 6px;
}
.rows {
  display: grid;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: 250px 100px 70px 1fr;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.025);
  border-left: 3px solid #2a3846;
  opacity: 0.85;
}
.row.own {
  opacity: 1;
  border-left-color: #2e7d5b;
}
.row.eq {
  border-left-color: #f0b83a;
  background: rgba(240, 184, 58, 0.06);
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
  font-size: 12px;
  color: #8f9aa6;
  border: 1px solid #3a4a5a;
}
.name {
  font-size: 15px;
  letter-spacing: 2px;
  color: #f1ead6;
}
.name em {
  font-style: normal;
  margin-left: 10px;
  font-size: 11px;
  color: #f0b83a;
  letter-spacing: 2px;
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
  color: #6fd0e8;
  border: 1px solid rgba(111, 208, 232, 0.4);
}
.pips {
  display: flex;
  gap: 4px;
}
.pips i {
  width: 14px;
  height: 5px;
  background: rgba(255, 255, 255, 0.12);
}
.pips i.cap {
  background: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 2px, transparent 2px 4px);
  outline: 1px solid rgba(255, 255, 255, 0.08);
}
.pips i.on {
  background: #f0b83a;
  box-shadow: 0 0 6px rgba(240, 184, 58, 0.6);
}
.dps .n {
  font-size: 24px;
  font-weight: 700;
  color: #f3e9cf;
  line-height: 1;
}
.dps .l {
  font-size: 10px;
  letter-spacing: 3px;
  color: #6f7c88;
}
.act {
  display: grid;
  gap: 4px;
  justify-items: start;
}
button {
  font-family: inherit;
  cursor: pointer;
  transition: 0.15s;
}
button.buy,
button.up {
  padding: 7px 16px;
  background: rgba(240, 184, 58, 0.1);
  border: 1px solid #8a6a20;
  color: #f0c85a;
  font-size: 13px;
  letter-spacing: 2px;
}
button.buy:hover:not(:disabled),
button.up:hover:not(:disabled) {
  background: #8a6a20;
  color: #fff;
}
button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.hint {
  font-size: 12px;
  color: #8f9aa6;
}
.hint b {
  color: #f1e8cc;
}
.maxed {
  font-size: 13px;
  letter-spacing: 6px;
  color: #4fc98d;
}
.maxed.off {
  letter-spacing: 2px;
  color: #6f7c88;
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
  border: 1px solid #3a4a5a;
  color: #a9b8c8;
  font-size: 12px;
}
.eq-btn:hover {
  border-color: #6fd0e8;
  color: #fff;
}
.foot {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #6f7c88;
}
.close {
  padding: 8px 20px;
  background: transparent;
  border: 1px solid #2c3a48;
  color: #8f9aa6;
  letter-spacing: 3px;
}
.close:hover {
  background: #1a2430;
  color: #fff;
}
</style>
