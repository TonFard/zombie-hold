<script setup lang="ts">
import { computed } from 'vue';
import { CARD_BY_ID, RARITY_NAME } from '../../game/data/cards';
import { ui } from '../store';

const list = computed(() => ui.cards.map((id) => CARD_BY_ID[id]).filter((c): c is NonNullable<typeof c> => !!c));
/** 稀有度英文代号（卡面右上角） */
const CODE: Record<string, string> = { common: 'STD', rare: 'RARE', epic: 'EPIC', curse: 'CURSE' };
</script>

<template>
  <div v-if="ui.screen === 'cards'" class="cards">
    <div class="scan" aria-hidden="true"></div>
    <div class="title">
      <small>DAWN · SUPPLY DROP</small>
      <h2>黎 明</h2>
      <p>天亮了，选一张卡带进下一夜</p>
    </div>
    <div class="row">
      <button v-for="(c, i) in list" :key="c.id" class="card t-panel" :class="c.rarity" :style="{ animationDelay: i * 0.12 + 's' }" @click="ui.actions.pickCard(c.id)">
        <div class="rar">
          <span>{{ RARITY_NAME[c.rarity] }}</span><small>{{ CODE[c.rarity] }}</small>
        </div>
        <div class="name">{{ c.name }}</div>
        <div class="desc">{{ c.desc }}</div>
        <div class="pick">点击选取 ▸</div>
      </button>
    </div>
    <button v-if="ui.rerolls > 0" class="t-btn reroll" @click="ui.actions.reroll()">重抽（剩 {{ ui.rerolls }} 次）</button>
  </div>
</template>

<style scoped>
.cards {
  position: fixed;
  inset: 0;
  z-index: 66;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 34px;
  color: var(--t-text);
  background: radial-gradient(ellipse at 50% 40%, rgba(40, 30, 10, 0.55), rgba(2, 3, 5, 0.92) 75%);
}
.scan {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.015) 0 1px, transparent 1px 3px);
  pointer-events: none;
}
.title {
  position: relative;
  text-align: center;
}
.title small {
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 5px;
  color: var(--t-dim);
}
h2 {
  margin-top: 6px;
  font-size: 38px;
  letter-spacing: 22px;
  padding-left: 22px;
  color: var(--t-gold);
  text-shadow: 0 0 30px rgba(240, 184, 58, 0.45);
  font-weight: 500;
}
.title p {
  margin-top: 8px;
  font-size: 13px;
  letter-spacing: 5px;
  color: var(--t-muted);
}
.row {
  position: relative;
  display: flex;
  gap: 22px;
}
/* 卡牌：战术面板 + 顶部稀有度色带；颜色都从 --rc 取 */
.card {
  --rc: #8fa0b2;
  --corner: var(--rc);
  width: 240px;
  height: 290px;
  padding: 24px 22px 18px;
  display: flex;
  flex-direction: column;
  text-align: left;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
  border-top: 3px solid var(--rc);
  transition: transform 0.18s var(--t-ease), box-shadow 0.18s var(--t-ease), border-color 0.18s var(--t-ease);
  animation: rise 0.5s var(--t-ease) both;
}
.card.rare {
  --rc: #5ab8f0;
  background: linear-gradient(180deg, rgba(20, 40, 60, 0.75), var(--t-panel));
}
.card.epic {
  --rc: #d08af0;
  background: linear-gradient(180deg, rgba(44, 22, 60, 0.78), var(--t-panel));
}
.card.curse {
  --rc: var(--t-red);
  background: linear-gradient(180deg, rgba(60, 14, 10, 0.8), var(--t-panel));
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .card {
    animation: none;
  }
}
.card:hover,
.card:focus-visible {
  outline: none;
  transform: translateY(-12px);
  border-color: var(--rc);
  box-shadow: 0 0 34px color-mix(in srgb, var(--rc) 45%, transparent);
}
.rar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  letter-spacing: 5px;
  color: var(--rc);
}
.rar small {
  font-family: var(--t-mono);
  font-size: 10px;
  letter-spacing: 3px;
  opacity: 0.7;
}
.name {
  margin: 20px 0 12px;
  padding-bottom: 12px;
  font-size: 24px;
  letter-spacing: 4px;
  color: #f4ecd6;
  border-bottom: 1px solid var(--t-line);
}
.desc {
  flex: 1;
  font-size: 16px;
  line-height: 1.7;
  color: #c3ced9;
}
.pick {
  font-size: 11px;
  letter-spacing: 5px;
  color: var(--t-dim);
  transition: color 0.18s var(--t-ease);
}
.card:hover .pick,
.card:focus-visible .pick {
  color: var(--rc);
}
.reroll {
  position: relative;
  padding: 8px 26px;
  font-size: 13px;
}
</style>
