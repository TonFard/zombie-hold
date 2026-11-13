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
  colossus: '外围据点的首领。冲锋前地上有红线，冲完硬直时打胸口的核心；半血以后狂暴，还会往远处砸碎石（看地上的红圈）',
  spitter: '远程吐酸，留下酸池；打破喉咙的酸囊一枪毙命',
  screamer: '尖叫让周围僵尸加速，必须先杀',
  crawler: '贴着地爬，能从路障底下钻过去，只追人。站着平射打不到，要压低枪口',
  armored: '肉盾。正面挂钢板，打身体只有四成伤害；钢板打够了会掉，掉了以后正面照常。打头、绕到背后、或者用爆炸',
  leaper: '路障拦不住它，隔着 3–8 米会扑过来。蹲下蓄力时打它能打断，落地后会缓一下',
  splitter: '打身体打死会裂成 3 只小爬行者，爆头或者炸死才干净',
  gasser: '贴近了会被毒气熏，死后留一团毒雾。用火烧死、炸死或者丢燃烧弹，毒气会爆燃炸伤一片僵尸',
  reaper: '荒野农场的首领。地上出现一条红线是要甩钩子：往旁边闪；被拽过去马上会接一刀横扫，往后退出扇形。半血以后叫来奔袭者',
  brood: '湖畔营地的首领。背上的卵囊不停孵出爬行者，绕到背后打卵囊（伤害更高，打爆一个少孵一只）。会往远处吐酸弹，看地上的绿圈',
  siren: '市区街道的首领。仰头蓄力是要尖叫：躲到墙后面，被叫中会走不动。会远远扑过来砸地，半血以后叫来一群奔袭者',
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
