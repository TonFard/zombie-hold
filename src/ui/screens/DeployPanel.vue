<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CHAPTERS, chapterUnlocked, type Chapter } from '../../game/data/chapters';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../../game/data/difficulty';
import { WEAPONS, WEAPON_ORDER, type WeaponKind } from '../../game/data/weapons';
import { dailyFor, todayKey } from '../../game/meta/achievements';
import { sidearmOk } from '../../game/meta/loadout';
import { bonusesOf, difficultyUnlocked, gunsFor } from '../../game/meta/progress';
import { GUN_BY_ID } from '../../game/data/guns';
import { gunIconOf } from '../gun-icons';
import { nightMod } from '../../game/data/modifiers';
import type { MapId } from '../../game/world/maps';
import { LEVELS, TDM } from '../../game/systems/tdm';
import { TDM_KEYS, TDM_LEVEL_NOTES, setTdmLevel, ui, type TdmLevel } from '../store';
import MapPreview from './MapPreview.vue';

/**
 * 出征页（UI-PLAN 3.2）：左 任务列表 / 中 战术地图 / 右 任务简报，底栏固定：
 * 左边训练场、每日挑战、团队死斗，右边「开始任务」。当前加成收进右上角可展开的状态条
 */
const meta = computed(() => ui.save.meta);
const bonuses = computed(() => bonusesOf(meta.value));

const difficulty = ref<Difficulty>(meta.value.lastDifficulty);
const sidearm = ref<WeaponKind | null>(meta.value.lastSidearm);
const chapter = ref<MapId>(meta.value.lastChapter ?? 'outpost');
const chapterOn = (id: MapId) => chapterUnlocked(meta.value.chapters, id);
const cur = computed<Chapter>(() => CHAPTERS.find((c) => c.id === chapter.value) ?? (CHAPTERS[0] as Chapter));
// 组件比存档先创建：每次进大厅时按存档里上次的选择重新填一遍
watch(
  () => ui.screen === 'lobby',
  (open) => {
    if (!open) return;
    const m = meta.value;
    difficulty.value = difficultyUnlocked(m, m.lastDifficulty) ? m.lastDifficulty : 'normal';
    sidearm.value = sidearmOk(bonuses.value, m.lastSidearm) ? m.lastSidearm : null;
    chapter.value = chapterOn(m.lastChapter) ? m.lastChapter : 'outpost';
  },
  { immediate: true },
);
const sidearms = computed<WeaponKind[]>(() => WEAPON_ORDER.filter((k) => sidearmOk(bonuses.value, k)));
/** 每一类出征时用的型号（随身武器的小图画的是它） */
const picked = computed(() => gunsFor(meta.value));

/** 章节状态：已通关 / 已开放 / 锁定 */
const stateOf = (c: Chapter): 'done' | 'open' | 'locked' => (meta.value.chapters.includes(c.id) ? 'done' : chapterOn(c.id) ? 'open' : 'locked');
const STATE_TEXT = { done: '已通关', open: '已开放', locked: '锁定' } as const;

/** 威胁等级：章节系数 × 难度系数的合成（生命 × 数量 × 伤害） */
const threat = computed(() => {
  const d = DIFFICULTIES[difficulty.value];
  const c = cur.value;
  const x = c.hp * d.hp * c.count * d.count * c.damage * d.damage;
  const lv = x < 1.2 ? 1 : x < 1.8 ? 2 : x < 2.8 ? 3 : x < 4.2 ? 4 : 5;
  return { lv, name: ['低', '中', '高', '极高', '致命'][lv - 1] as string, x };
});
/** 任务目标：所有章节一样的流程，只有地点和首领不同 */
const goals = computed(() => [
  `修好并守住${cur.value.place.includes('信号塔') ? '信号塔的' : '据点的'}发电机`,
  '白天搜刮零件、布置路障和炮塔',
  '撑过 10 个夜晚（第 5、10 夜有首领）',
]);
const diffNote = (d: Difficulty): string => {
  const def = DIFFICULTIES[d];
  if (!difficultyUnlocked(meta.value, d)) return `通关${DIFFICULTIES[def.requires as Difficulty].name}后解锁`;
  if (d === 'normal') return '标准难度';
  return `生命 ×${def.hp} · 数量 ×${def.count} · 伤害 ×${def.damage} · 勋章 ×${def.medals}`;
};

/** 有检查点时出征要二次确认：会放弃上一局 */
const confirming = ref(false);
const deploy = (): void => {
  if (!chapterOn(chapter.value)) return;
  if (ui.checkpoint && !confirming.value) {
    confirming.value = true;
    return;
  }
  confirming.value = false;
  const side = sidearm.value && sidearms.value.includes(sidearm.value) ? sidearm.value : null;
  ui.actions.deploy(difficulty.value, side, chapter.value);
};

/** 当前加成：顶部状态条，默认只显示几个关键数字，点开看全部 */
const showBonus = ref(false);
const summary = computed(() => {
  const b = bonuses.value;
  const out: string[] = [];
  out.push(`可用武器 ${b.weapons.size} 把`);
  out.push(`炮塔上限 ${b.turretCap} 座`);
  if (b.structures.size > 3) out.push(`新炮塔 ${b.structures.size - 3} 种`);
  if (b.startScrap) out.push(`开局零件 +${b.startScrap}`);
  if (b.maxHp) out.push(`生命 +${b.maxHp}`);
  if (b.coreHp) out.push(`发电机 +${b.coreHp}`);
  if (b.turretDamage > 1) out.push(`炮塔伤害 +${Math.round((b.turretDamage - 1) * 100)}%`);
  if (b.structHp > 1) out.push(`建筑生命 +${Math.round((b.structHp - 1) * 100)}%`);
  if (b.scrapGain > 1) out.push(`零件收益 +${Math.round((b.scrapGain - 1) * 100)}%`);
  if (b.rerolls) out.push('卡牌可重抽');
  if (b.cardChoices > 3) out.push('卡牌四选一');
  return out;
});

/** 8v8 的规则和按键：点「？」向上展开 */
const showTdm = ref(false);

const daily = dailyFor(todayKey());
const dailyBest = computed(() => ui.save.codex.daily[daily.key]);
const savedAt = computed(() => (ui.checkpoint?.savedAt ? new Date(ui.checkpoint.savedAt).toLocaleString() : ''));
</script>

<template>
  <section class="deploy t-enter">
    <!-- 左：任务列表 -->
    <nav class="missions t-panel" aria-label="任务列表">
      <div class="t-head">任务列表 <small>MISSIONS</small></div>
      <button
        v-for="c in CHAPTERS"
        :key="c.id"
        class="mis"
        :class="[stateOf(c), { on: chapter === c.id }]"
        :aria-pressed="chapter === c.id"
        @click="chapter = c.id"
      >
        <span class="no">{{ String(c.index).padStart(2, '0') }}</span>
        <span class="tx">
          <b>{{ c.name.split(' · ')[1] ?? c.name }}</b>
          <small>{{ stateOf(c) === 'locked' ? '通关上一章解锁' : c.place }}</small>
        </span>
        <em :class="stateOf(c)">{{ stateOf(c) === 'locked' ? '🔒' : stateOf(c) === 'done' ? '✓' : '' }}<template v-if="stateOf(c) !== 'locked'"> {{ STATE_TEXT[stateOf(c)] }}</template></em>
      </button>
    </nav>

    <!-- 中：战术地图 -->
    <div class="center">
      <div class="map-wrap">
        <MapPreview :id="chapter" :locked="stateOf(cur) === 'locked'" />
      </div>
      <div class="map-cap">
        <b>{{ cur.name }}</b>
        <span>僵尸生命 ×{{ cur.hp }}</span>
        <span>数量 ×{{ cur.count }}</span>
        <span>伤害 ×{{ cur.damage }}</span>
        <span class="g">零件 ×{{ cur.scrap }}</span>
        <span class="g">勋章 / 补给 ×{{ cur.medals }}</span>
      </div>
    </div>

    <!-- 右：任务简报 -->
    <aside class="brief t-panel" aria-label="任务简报">
      <div class="t-head">任务简报 <small>BRIEFING</small></div>
      <h3>{{ cur.name.split(' · ')[1] ?? cur.name }}</h3>
      <p class="place">{{ cur.place }}</p>
      <div class="threat">
        <span>威胁等级</span>
        <span class="pips" :aria-label="`${threat.lv} / 5`"><i v-for="i in 5" :key="i" :class="{ on: i <= threat.lv }"></i></span>
        <b :class="`lv${threat.lv}`">{{ threat.name }}</b>
      </div>
      <p class="story">{{ cur.intro }}</p>

      <div class="sub">任务目标</div>
      <ol class="goals">
        <li v-for="(g, i) in goals" :key="i"><span>{{ String(i + 1).padStart(2, '0') }}</span>{{ g }}</li>
      </ol>
      <div class="sub">推荐武器</div>
      <p class="rec">{{ cur.weapons.map((k) => WEAPONS[k].name).join(' / ') }}</p>

      <div class="sub">难度</div>
      <div class="t-seg">
        <button v-for="d in DIFFICULTY_ORDER" :key="d" :class="{ on: difficulty === d }" :disabled="!difficultyUnlocked(meta, d)" :title="diffNote(d)" @click="difficulty = d">
          {{ difficultyUnlocked(meta, d) ? '' : '🔒 ' }}{{ DIFFICULTIES[d].name }}
        </button>
      </div>
      <p class="note">{{ diffNote(difficulty) }}</p>

      <div class="sub">主武器</div>
      <p v-if="!sidearms.length" class="note">还没解锁别的枪：这一局带手枪。在军械库解锁以后，这里直接选（不用在局内再买）</p>
      <!-- 一行两个、每格一样大：名字再长也不会挤到旁边的格子上（以前是一排平分，四五把枪时字叠在一起） -->
      <div v-else class="side-grid" role="group" aria-label="主武器">
        <button :class="{ on: sidearm === null }" :aria-pressed="sidearm === null" @click="sidearm = null">
          <span class="spic none" aria-hidden="true"></span>
          <b>最新解锁的</b>
        </button>
        <button v-for="k in sidearms" :key="k" :class="{ on: sidearm === k }" :aria-pressed="sidearm === k" :title="`${WEAPONS[k].name} · ${GUN_BY_ID[picked[k]]?.name ?? ''}`" @click="sidearm = k">
          <span class="spic"><img v-if="gunIconOf(picked[k])" :src="gunIconOf(picked[k])" alt="" /></span>
          <b>{{ WEAPONS[k].name }}</b>
        </button>
      </div>
    </aside>

    <!-- 底栏 -->
    <footer class="actions">
      <div class="side">
        <!-- 当前加成：折叠的状态条，点开向上展开 -->
        <div class="bonus">
          <button class="bonus-btn" :aria-expanded="showBonus" @click="showBonus = !showBonus">
            <span>当前加成</span><b>{{ summary.length }}</b><i>{{ showBonus ? '▾' : '▴' }}</i>
          </button>
          <div v-if="showBonus" class="bonus-list t-panel">
            <span v-for="x in summary" :key="x">{{ x }}</span>
          </div>
        </div>
        <div v-if="ui.checkpoint" class="cont">
          <span>上一局 · 第 {{ ui.checkpoint.night }} 天 · {{ DIFFICULTIES[ui.checkpoint.difficulty].name }} · 生命 {{ ui.checkpoint.hp }}/{{ ui.checkpoint.maxHp }}<template v-if="savedAt"> · {{ savedAt }}</template></span>
          <button class="t-btn gold" @click="ui.actions.continueRun()">继续上一局</button>
        </div>
        <button class="t-btn" @click="ui.actions.training()">训练场</button>
        <button class="t-btn" :title="`「${nightMod(daily.mod).name}」· 只用${WEAPONS[daily.weapon].name}`" @click="ui.actions.daily()">
          每日挑战 <small>{{ daily.key.slice(5) }} · 最好 {{ dailyBest !== undefined ? `${dailyBest} 夜` : '—' }}</small>
        </button>
        <!-- 8v8 对战：先选人机难度（记在本机），再开打；「？」里是规则和按键 -->
        <div class="tdm">
          <div v-if="showTdm" class="tdm-info t-panel">
            <div class="t-head">8v8 对战 <small>北港仓库</small></div>
            <p>先赢 {{ TDM.winRounds }} 局，每局一条命。开局的冻结时间里按 B 用金币买枪、护甲、手雷；打空了能捡地上的枪，刀人人都有。</p>
            <p><b>人机 · {{ LEVELS[ui.tdmLevel].name }}</b>{{ TDM_LEVEL_NOTES[ui.tdmLevel] }}。队友和敌人是同一档。</p>
            <p class="nob">不吃任何局外加成：大厅里买的生命 / 移速 / 射速、仓库里的强化、枪的星级和解锁的型号都不带进去——所有人 {{ TDM.hp }} 血、同一套枪。</p>
            <div class="tdm-keys">
              <div v-for="k in TDM_KEYS" :key="k[0]"><kbd>{{ k[0] }}</kbd><span>{{ k[1] }}</span></div>
            </div>
          </div>
          <span class="tdm-cap">8v8 人机</span>
          <div class="t-seg tdm-seg" role="group" aria-label="8v8 人机难度">
            <button v-for="(l, i) in LEVELS" :key="l.name" :class="{ on: ui.tdmLevel === i }" :aria-pressed="ui.tdmLevel === i" :title="TDM_LEVEL_NOTES[i]" @click="setTdmLevel(i as TdmLevel)">{{ l.name }}</button>
          </div>
          <button class="t-btn" :title="`人机${LEVELS[ui.tdmLevel].name} · 不吃局外加成`" @click="ui.actions.tdm(ui.tdmLevel)">8v8 对战 · 北港仓库</button>
          <button class="tdm-q" :aria-expanded="showTdm" aria-label="8v8 的规则和按键" title="规则和按键" @click="showTdm = !showTdm">?</button>
        </div>
      </div>
      <div class="go-wrap">
        <button v-if="confirming" class="t-btn" @click="confirming = false">取消</button>
        <button class="t-btn primary go" :disabled="stateOf(cur) === 'locked'" @click="deploy()">
          {{ stateOf(cur) === 'locked' ? '章节未解锁' : confirming ? '放弃上一局并出征' : '开 始 任 务' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.deploy {
  position: relative;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 330px;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 16px 18px;
  height: 100%;
  min-height: 0;
}
.missions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 14px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.mis {
  position: relative;
  display: grid;
  grid-template-columns: 34px 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  padding: 12px 12px 10px;
  text-align: left;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--t-line);
  border-left: 3px solid transparent;
  color: var(--t-text);
  font: inherit;
  cursor: pointer;
  transition: 0.15s var(--t-ease);
}
.mis:hover,
.mis:focus-visible {
  outline: none;
  border-color: var(--t-line-strong);
  background: rgba(255, 255, 255, 0.05);
}
.mis.on {
  border-color: rgba(240, 184, 58, 0.55);
  border-left-color: var(--t-gold);
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.12), rgba(240, 184, 58, 0.02));
}
.mis .no {
  grid-row: span 2;
  font-family: var(--t-mono);
  font-size: 22px;
  font-weight: 600;
  color: var(--t-dim);
}
.mis.on .no {
  color: var(--t-gold);
}
.mis .tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mis b {
  font-size: 15px;
  letter-spacing: 3px;
}
.mis small {
  font-size: 12px;
  color: var(--t-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mis em {
  grid-column: 2;
  margin-top: 6px;
  font-style: normal;
  font-size: 11px;
  letter-spacing: 2px;
}
em.done {
  color: var(--t-ok);
}
em.open {
  color: var(--t-cyan);
}
/* 锁定：暗一档 + 锁，但仍然能点开看情报 */
.mis.locked {
  opacity: 0.55;
}
.mis.locked b {
  color: var(--t-muted);
}
.center {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  min-width: 0;
}
.map-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
}
.map-cap {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 6px 14px;
  font-size: 12px;
  color: var(--t-muted);
  font-family: var(--t-mono);
}
.map-cap b {
  font-family: inherit;
  font-size: 15px;
  letter-spacing: 3px;
  color: var(--t-text);
  margin-right: 6px;
}
.map-cap .g {
  color: var(--t-gold-soft);
}
.brief {
  padding: 16px 18px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.brief h3 {
  font-size: 22px;
  letter-spacing: 5px;
  color: #eef1f3;
}
.place {
  margin-top: 4px;
  font-size: 13px;
  color: var(--t-cyan);
}
.threat {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.threat .pips {
  display: flex;
  gap: 3px;
}
.threat .pips i {
  width: 14px;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
}
.threat .pips i.on {
  background: var(--t-red);
  box-shadow: 0 0 6px rgba(232, 85, 63, 0.6);
}
.threat b {
  font-size: 13px;
  color: var(--t-red);
}
.threat b.lv1 {
  color: var(--t-ok);
}
.threat b.lv2 {
  color: var(--t-gold);
}
.story {
  margin-top: 12px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.75;
  color: #c8bea8;
  border-left: 2px solid var(--t-gold-soft);
  background: rgba(217, 201, 160, 0.05);
}
.sub {
  margin: 16px 0 8px;
  font-size: 11px;
  letter-spacing: 4px;
  color: var(--t-dim);
  display: flex;
  align-items: center;
  gap: 10px;
}
.sub::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--t-line);
}
.goals {
  list-style: none;
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #c8ced4;
}
.goals span {
  font-family: var(--t-mono);
  color: var(--t-gold);
  margin-right: 10px;
}
.rec {
  font-size: 13px;
  color: var(--t-gold-soft);
}
.note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--t-dim);
}
/* 随身武器：两列的格子，每格 = 枪的侧视图 + 名字 */
.side-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.side-grid button {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--t-line);
  color: var(--t-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s var(--t-ease), background 0.15s var(--t-ease), color 0.15s var(--t-ease);
}
.side-grid button:hover,
.side-grid button:focus-visible {
  outline: none;
  color: var(--t-text);
  border-color: var(--t-line-strong);
}
.side-grid button.on {
  color: var(--t-gold);
  border-color: rgba(240, 184, 58, 0.6);
  background: rgba(240, 184, 58, 0.09);
}
.side-grid b {
  font-size: 12.5px;
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 图是异步画出来的：位置先占好 */
.spic {
  width: 40px;
  height: 17px;
}
.spic img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(1.6) contrast(1.05);
}
.spic.none {
  position: relative;
}
.spic.none::before {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  top: 50%;
  border-top: 1px dashed var(--t-dim);
}
.bonus {
  position: relative;
  z-index: 3;
}
.bonus-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(111, 208, 232, 0.06);
  border: 1px solid rgba(111, 208, 232, 0.3);
  color: var(--t-cyan);
  font: inherit;
  font-size: 12px;
  letter-spacing: 2px;
  cursor: pointer;
}
.bonus-btn b {
  font-family: var(--t-mono);
  color: #fff;
}
.bonus-btn i {
  font-style: normal;
}
.bonus-list {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: 330px;
  padding: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  background: var(--t-panel-strong);
  --corner: rgba(111, 208, 232, 0.7);
}
.bonus-list span {
  padding: 3px 9px;
  font-size: 12px;
  color: #aeb8c2;
  background: rgba(111, 208, 232, 0.07);
  border: 1px solid rgba(111, 208, 232, 0.2);
}
/* 8v8：难度三选一 + 开打 + 说明 */
.tdm {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 12px;
  border-left: 1px solid var(--t-line);
}
.tdm-cap {
  margin-right: 2px;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.tdm-seg {
  flex-wrap: nowrap;
  gap: 3px;
}
.tdm-seg button {
  flex: none;
  padding: 9px 10px;
  font-size: 12px;
}
.tdm-q {
  width: 30px;
  height: 38px;
  background: rgba(111, 208, 232, 0.06);
  border: 1px solid rgba(111, 208, 232, 0.3);
  color: var(--t-cyan);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.tdm-q:hover,
.tdm-q:focus-visible,
.tdm-q[aria-expanded='true'] {
  outline: none;
  background: rgba(111, 208, 232, 0.16);
  color: #fff;
}
.tdm-info {
  position: absolute;
  left: 12px;
  bottom: calc(100% + 8px);
  width: 470px;
  padding: 14px 16px;
  background: var(--t-panel-strong);
  --corner: rgba(111, 208, 232, 0.7);
}
.tdm-info p {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #aeb8c2;
}
.tdm-info p b {
  margin-right: 8px;
  color: var(--t-gold);
}
.tdm-info p.nob {
  color: var(--t-cyan);
}
.tdm-keys {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 14px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--t-line);
  font-size: 12px;
  color: var(--t-muted);
}
.tdm-keys kbd {
  display: inline-block;
  min-width: 22px;
  margin-right: 8px;
  padding: 0 6px;
  border: 1px solid var(--t-line-strong);
  border-radius: 2px;
  font: 600 11px/17px var(--hud-font);
  text-align: center;
  color: var(--t-text);
}
.actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--t-line);
}
.side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.side small {
  margin-left: 6px;
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--t-dim);
}
.cont {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-right: 14px;
  margin-right: 4px;
  border-right: 1px solid var(--t-line);
  font-size: 12px;
  color: var(--t-muted);
}
.go-wrap {
  display: flex;
  gap: 10px;
}
.go {
  padding: 15px 56px;
  font-size: 18px;
  letter-spacing: 10px;
}
@media (max-width: 1360px) {
  .deploy {
    grid-template-columns: 210px minmax(0, 1fr) 290px;
  }
  /* 简报栏变窄：随身武器不放小图，名字才写得下 */
  .side-grid button {
    grid-template-columns: minmax(0, 1fr);
    text-align: center;
  }
  .spic {
    display: none;
  }
  .cont span {
    display: none;
  }
}
</style>
