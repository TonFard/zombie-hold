<script setup lang="ts">
import { computed } from 'vue';
import { CARD_BY_ID, RARITY_NAME } from '../../game/data/cards';
import { ui } from '../store';

const list = computed(() => ui.cards.map((id) => CARD_BY_ID[id]).filter((c): c is NonNullable<typeof c> => !!c));
</script>

<template>
  <div v-if="ui.screen === 'cards'" class="cards">
    <div class="title">
      <h2>黎 明</h2>
      <p>选一张卡牌强化自己</p>
    </div>
    <div class="row">
      <button v-for="(c, i) in list" :key="c.id" class="card" :class="c.rarity" :style="{ animationDelay: i * 0.12 + 's' }" @click="ui.actions.pickCard(c.id)">
        <div class="rar">{{ RARITY_NAME[c.rarity] }}</div>
        <div class="name">{{ c.name }}</div>
        <div class="desc">{{ c.desc }}</div>
      </button>
    </div>
    <button v-if="ui.rerolls > 0" class="reroll" @click="ui.actions.reroll()">重抽（剩 {{ ui.rerolls }} 次）</button>
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
  gap: 36px;
  background: radial-gradient(ellipse at center, rgba(8, 12, 18, 0.7), rgba(2, 3, 5, 0.92));
}
.reroll {
  padding: 8px 26px;
  background: transparent;
  border: 1px solid rgba(111, 208, 232, 0.5);
  color: #6fd0e8;
  font: inherit;
  font-size: 13px;
  letter-spacing: 4px;
  cursor: pointer;
}
.reroll:hover {
  background: rgba(111, 208, 232, 0.12);
}
.title {
  text-align: center;
}
h2 {
  font-size: 36px;
  letter-spacing: 22px;
  color: #f0c85a;
  font-weight: 300;
  padding-left: 22px;
}
.title p {
  margin-top: 8px;
  font-size: 13px;
  letter-spacing: 6px;
  color: #8f9aa6;
}
.row {
  display: flex;
  gap: 22px;
}
.card {
  position: relative;
  width: 240px;
  height: 280px;
  padding: 26px 22px;
  border-top: 3px solid #8fa0b2;
  display: flex;
  flex-direction: column;
  text-align: left;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
  background: linear-gradient(180deg, #151d26, #0b1016);
  border: 1px solid #2c3a48;
  transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
  animation: rise 0.5s ease both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
}
.card:hover {
  transform: translateY(-12px);
}
.card.common:hover {
  border-color: #8fa0b2;
  box-shadow: 0 0 30px rgba(143, 160, 178, 0.35);
}
.card.rare {
  border-color: #2f6f9a;
  border-top-color: #5ab8f0;
}
.card.rare:hover {
  border-color: #5ab8f0;
  box-shadow: 0 0 34px rgba(90, 184, 240, 0.45);
}
.card.epic {
  border-color: #8a4aa8;
  border-top-color: #d08af0;
  background: linear-gradient(180deg, #1d1428, #0e0a14);
}
.card.curse {
  border-color: #7a1a1a;
  border-top-color: #e8553f;
  background: linear-gradient(180deg, #2a0e0c, #120605);
}
.card.curse:hover {
  border-color: #e8553f;
  box-shadow: 0 0 40px rgba(232, 85, 63, 0.5);
}
.card.epic:hover {
  border-color: #d08af0;
  box-shadow: 0 0 40px rgba(208, 138, 240, 0.5);
}
.rar {
  font-size: 11px;
  letter-spacing: 6px;
  color: #8f9aa6;
}
.rare .rar {
  color: #5ab8f0;
}
.epic .rar {
  color: #d08af0;
}
.name {
  margin: 20px 0 14px;
  font-size: 24px;
  letter-spacing: 4px;
  color: #f4ecd6;
}
.desc {
  font-size: 17px;
  line-height: 1.7;
  color: #c3ced9;
}
.card::after {
  content: '点击选取';
  position: absolute;
  left: 22px;
  bottom: 18px;
  font-size: 11px;
  letter-spacing: 6px;
  color: #56626e;
  transition: color 0.18s;
}
.card:hover::after {
  color: #f0c85a;
}
</style>
