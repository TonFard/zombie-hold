<script setup lang="ts">
import { computed } from 'vue';
import { ZOMBIES, type ZombieKind } from '../../game/data/zombies';
import { ACHIEVEMENTS } from '../../game/meta/achievements';
import { ui } from '../store';

const codex = computed(() => ui.save.codex);
const NOTES: Record<ZombieKind, string> = {
  walker: '最常见。慢，但成群结队',
  runner: '冲得快、血薄，第 2 夜起出现',
  bloater: '死后爆出酸液，别在近处打死它',
  breaker: '戴头盔，专拆路障',
  colossus: '首领。冲锋前地上有红线，冲完硬直时打胸口的核心',
  spitter: '远程吐酸，留下酸池；打破喉咙的酸囊一枪毙命',
  screamer: '尖叫让周围僵尸加速，必须先杀',
};
const kinds = Object.keys(ZOMBIES) as ZombieKind[];
const doneCount = computed(() => ACHIEVEMENTS.filter((a) => codex.value.done.includes(a.id)).length);
</script>

<template>
  <div class="codex">
    <div class="card">
      <h3>图鉴</h3>
      <div class="zs">
        <div v-for="k in kinds" :key="k" class="z" :class="{ seen: (codex.kills[k] ?? 0) > 0 }">
          <b>{{ (codex.kills[k] ?? 0) > 0 ? ZOMBIES[k].name : '？？？' }}</b>
          <span v-if="(codex.kills[k] ?? 0) > 0">击杀 {{ codex.kills[k] }} · 生命 {{ ZOMBIES[k].hp }}</span>
          <p>{{ (codex.kills[k] ?? 0) > 0 ? NOTES[k] : '还没遇到过' }}</p>
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
  color: #6fd0e8;
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
  color: #6f7c88;
}
.z.seen {
  border-color: #e8553f;
  color: #aeb8c2;
}
.z b {
  color: #f1e8cc;
  margin-right: 10px;
}
.z span {
  font-size: 12px;
}
.z p {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
}
.a {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 10px;
  padding: 6px 10px;
  font-size: 13px;
  color: #6f7c88;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.a.done {
  color: #aeb8c2;
  border-color: rgba(240, 184, 58, 0.4);
  background: rgba(240, 184, 58, 0.05);
}
.a b {
  color: #d8dee4;
}
.a.done b,
.a i {
  color: #f0b83a;
  font-style: normal;
}
</style>
