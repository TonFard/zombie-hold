<script setup lang="ts">
import { computed } from 'vue';
import { CARD_BY_ID, RARITY_NAME } from '../../game/data/cards';
import { hud } from '../hud';
import type { IconName } from '../icons';
import TIcon from '../TIcon.vue';
import { ui } from '../store';

/** 每张牌的图标（没列到的用默认的那个） */
const ART: Record<string, IconName> = {
  vitality: 'heart',
  agility: 'boot',
  fortify: 'wall',
  overclock: 'turret',
  scavenger: 'gear',
  quickhands: 'reload',
  endurance: 'pulse',
  steady: 'scope',
  medkit: 'medic',
  crit: 'rage',
  ap: 'blast',
  armor: 'shield',
  corehp: 'battery',
  weakspot: 'skull',
  gunsmith: 'ammo',
  lifesteal: 'drop',
  regen: 'wrench',
  berserk: 'flame',
  chain: 'chain',
  momentum: 'trend',
  scavmag: 'mag',
  brawler: 'fist',
  demo: 'grenade',
  deepmag: 'mag',
  killrush: 'speed',
  quartermaster: 'coin',
  doublejump: 'wings',
  incendiary: 'flame',
  frost: 'snow',
  piercer: 'arrowThru',
  laststand: 'fist',
  suppress: 'rate',
  headhunter: 'skull',
  unyielding: 'phoenix',
  'c-glass': 'glass',
  'c-overdrive': 'bolt',
  'c-greed': 'coin',
  'c-adrenal': 'pulse',
};
/** 稀有度英文代号（卡面右上角） */
const CODE: Record<string, string> = { common: 'STD', rare: 'RARE', epic: 'EPIC', curse: 'CURSE' };

const list = computed(() =>
  ui.cards
    .map((id) => CARD_BY_ID[id])
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => {
      const have = hud.buffs.find((b) => b.id === c.id)?.n ?? 0;
      return { ...c, art: ART[c.id] ?? ('star' as IconName), have };
    }),
);
</script>

<template>
  <div v-if="ui.screen === 'cards'" class="cards">
    <div class="scan" aria-hidden="true"></div>
    <div class="title">
      <small>DAWN · FIELD UPGRADE</small>
      <h2>黎 明</h2>
      <p>天亮了，选一张卡带进下一夜</p>
    </div>
    <div class="row">
      <button v-for="(c, i) in list" :key="c.id" class="card" :class="c.rarity" :style="{ animationDelay: i * 0.12 + 's' }" @click="ui.actions.pickCard(c.id)">
        <span class="edge" aria-hidden="true"></span>
        <div class="rar">
          <span>{{ RARITY_NAME[c.rarity] }}</span><small>{{ CODE[c.rarity] }}</small>
        </div>
        <!-- 图标：六边形的底 + 一圈刻度 + 这张牌自己的图 -->
        <div class="art" aria-hidden="true">
          <svg class="hex" viewBox="0 0 120 120">
            <path class="h1" d="M60 8 105 34v52L60 112 15 86V34Z" />
            <path class="h2" d="M60 20 94.6 40v40L60 100 25.4 80V40Z" />
            <circle class="tick" cx="60" cy="60" r="55" />
          </svg>
          <TIcon :name="c.art" />
        </div>
        <div class="name">{{ c.name }}</div>
        <div class="desc">{{ c.desc }}</div>
        <!-- 能叠几张：一格一张，已经有的点亮，这次拿的闪一下 -->
        <div class="stack">
          <template v-if="c.max <= 6">
            <i v-for="n in c.max" :key="n" :class="{ on: n <= c.have, next: n === c.have + 1 }"></i>
          </template>
          <small>{{ c.max > 6 ? '可以重复拿' : c.have > 0 ? `已有 ${c.have} 张` : c.max === 1 ? '只有一张' : `最多 ${c.max} 张` }}</small>
        </div>
        <div class="pick">选 取<TIcon name="chevron" /></div>
      </button>
    </div>
    <button v-if="ui.rerolls > 0" class="t-btn reroll" @click="ui.actions.reroll()"><TIcon name="reload" />重抽（剩 {{ ui.rerolls }} 次）</button>
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
  gap: 30px;
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
.title h2 {
  margin-top: 4px;
  font-size: 44px;
  letter-spacing: 22px;
  text-indent: 22px;
  color: var(--t-gold);
  text-shadow: 0 0 34px rgba(240, 184, 58, 0.35);
}
.title p {
  margin-top: 6px;
  font-size: 13px;
  letter-spacing: 4px;
  color: var(--t-muted);
}
.row {
  position: relative;
  display: flex;
  gap: 22px;
}
/* 一张牌：大小写死（悬停只换边框和光，不放大、不位移），--rc = 稀有度的颜色 */
.card {
  --rc: #9aa6b2;
  position: relative;
  display: grid;
  grid-template-rows: 22px 132px 34px 66px 30px 40px;
  justify-items: center;
  width: 262px;
  height: 392px;
  padding: 16px 20px 14px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--rc) 13%, transparent), transparent 46%),
    rgba(9, 13, 19, 0.94);
  border: 1px solid color-mix(in srgb, var(--rc) 45%, transparent);
  color: var(--t-text);
  font: inherit;
  text-align: center;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
  animation: rise 0.5s var(--t-ease) both;
  transition: border-color 0.15s var(--t-ease), background 0.15s var(--t-ease);
}
.card.rare {
  --rc: #6fd0e8;
}
.card.epic {
  --rc: #f0b83a;
}
.card.curse {
  --rc: #e8553f;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(26px);
  }
}
/* 顶上一道稀有度颜色的光 */
.edge {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 3px;
  background: var(--rc);
  box-shadow: 0 0 16px var(--rc);
}
.card:hover,
.card:focus-visible {
  outline: none;
  border-color: var(--rc);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--rc) 24%, transparent), transparent 60%),
    rgba(12, 17, 24, 0.97);
}
.rar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  letter-spacing: 4px;
  color: var(--rc);
}
.rar small {
  font-family: var(--t-mono);
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--t-dim);
}
.art {
  position: relative;
  display: grid;
  place-items: center;
  width: 120px;
  height: 120px;
  margin-top: 6px;
  font-size: 52px;
  color: var(--rc);
}
.hex {
  position: absolute;
  inset: 0;
  fill: none;
}
.hex .h1 {
  stroke: color-mix(in srgb, var(--rc) 70%, transparent);
  stroke-width: 1.5;
  fill: color-mix(in srgb, var(--rc) 9%, transparent);
}
.hex .h2 {
  stroke: color-mix(in srgb, var(--rc) 30%, transparent);
  stroke-width: 1;
}
.hex .tick {
  stroke: color-mix(in srgb, var(--rc) 45%, transparent);
  stroke-width: 3;
  stroke-dasharray: 1 7.64;
}
.art .t-ico {
  position: relative;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--rc) 60%, transparent));
}
.name {
  align-self: center;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 5px;
  text-indent: 5px;
  color: #f2f4f6;
}
.desc {
  align-self: start;
  font-size: 13.5px;
  line-height: 1.6;
  color: #b8c2cc;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.stack {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--t-dim);
}
.stack i {
  width: 16px;
  height: 5px;
  background: rgba(255, 255, 255, 0.14);
}
.stack i.on {
  background: var(--rc);
}
.stack i.next {
  background: #fff;
  box-shadow: 0 0 8px var(--rc);
  animation: blink 0.9s ease-in-out infinite;
}
@keyframes blink {
  50% {
    opacity: 0.35;
  }
}
.stack small {
  margin-left: 6px;
  letter-spacing: 1px;
}
.pick {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 40px;
  font-size: 14px;
  letter-spacing: 6px;
  color: var(--rc);
  border: 1px solid color-mix(in srgb, var(--rc) 45%, transparent);
  background: color-mix(in srgb, var(--rc) 7%, transparent);
  transition: background 0.15s var(--t-ease), color 0.15s var(--t-ease);
}
.pick .t-ico {
  font-size: 14px;
}
.card:hover .pick,
.card:focus-visible .pick {
  background: var(--rc);
  color: #0b0f14;
}
.reroll {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 26px;
  font-size: 13px;
}
@media (max-height: 760px) {
  .cards {
    gap: 16px;
  }
  .title h2 {
    font-size: 32px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .stack i.next {
    animation: none;
  }
}
</style>
