<script setup lang="ts">
import { computed } from 'vue';
import { BOSS_KINDS, ZOMBIES, type ZombieKind } from '../../game/data/zombies';
import { ZOMBIE_INTEL } from '../../game/data/zombie-intel';
import { ACHIEVEMENTS } from '../../game/meta/achievements';
import { ui } from '../store';

const codex = computed(() => ui.save.codex);
const kinds = Object.keys(ZOMBIES) as ZombieKind[];
const doneCount = computed(() => ACHIEVEMENTS.filter((a) => codex.value.done.includes(a.id)).length);
</script>

<template>
  <div class="codex">
    <div class="card">
      <h3>图鉴</h3>
      <div class="zs">
        <div v-for="k in kinds" :key="k" class="z" :class="{ seen: (codex.kills[k] ?? 0) > 0, boss: BOSS_KINDS.includes(k) }">
          <template v-if="(codex.kills[k] ?? 0) > 0">
            <div class="zh">
              <b>{{ ZOMBIES[k].name }}</b>
              <i v-for="t in ZOMBIE_INTEL[k].tags" :key="t">{{ t }}</i>
              <span>击杀 {{ codex.kills[k] }} · 生命 {{ ZOMBIES[k].hp }}</span>
            </div>
            <p><em>能力</em>{{ ZOMBIE_INTEL[k].ability }}</p>
            <p class="ct"><em>对策</em>{{ ZOMBIE_INTEL[k].counter }}</p>
          </template>
          <template v-else>
            <b>？？？</b>
            <p>还没打死过。第一次遇到时，局内左侧会弹出它的能力和对策</p>
          </template>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>成就 {{ doneCount }} / {{ ACHIEVEMENTS.length }}</h3>
      <div class="as">
        <div v-for="a in ACHIEVEMENTS" :key="a.id" class="a" :class="{ done: codex.done.includes(a.id) }">
          <b>{{ a.name }}</b><span>{{ a.desc }}</span><i>✦ {{ a.medals }}</i>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.codex {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.card {
  background: rgba(10, 14, 18, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 16px 20px;
}
h3 {
  font-size: 12px;
  letter-spacing: 8px;
  color: var(--t-cyan);
  margin: 0 0 12px;
  font-weight: 400;
}
.zs,
.as {
  display: grid;
  gap: 8px;
}
.z {
  padding: 8px 12px;
  border-left: 3px solid rgba(255, 255, 255, 0.12);
  color: var(--t-dim);
}
.z.seen {
  border-color: var(--t-red);
  color: #aeb8c2;
}
.z.seen.boss {
  border-color: var(--t-gold);
}
.z b {
  color: #f1e8cc;
  margin-right: 10px;
}
.zh {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
/* 标签：一眼能看完的两三个词 */
.zh i {
  padding: 0 6px;
  font-style: normal;
  font-size: 11px;
  line-height: 17px;
  color: #e8b3a6;
  border: 1px solid rgba(232, 85, 63, 0.4);
  background: rgba(232, 85, 63, 0.08);
}
.boss .zh i {
  color: var(--t-gold);
  border-color: rgba(240, 184, 58, 0.45);
  background: rgba(240, 184, 58, 0.08);
}
.zh span {
  margin-left: auto;
  font-size: 12px;
}
.z p {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
}
.z p em {
  margin-right: 8px;
  font-style: normal;
  font-size: 11px;
  color: var(--t-dim);
}
.z p.ct {
  color: var(--t-cyan);
}
.a {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 10px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--t-dim);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.a.done {
  color: #aeb8c2;
  border-color: rgba(240, 184, 58, 0.4);
  background: rgba(240, 184, 58, 0.05);
}
.a b {
  color: var(--t-text);
}
.a.done b,
.a i {
  color: var(--t-gold);
  font-style: normal;
}
</style>
