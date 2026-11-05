<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { startApp, type App } from './app/boot';
import Banner from './ui/hud/Banner.vue';
import Bench from './ui/screens/Bench.vue';
import BuildBar from './ui/hud/BuildBar.vue';
import Cards from './ui/screens/Cards.vue';
import Hud from './ui/hud/Hud.vue';
import Toast from './ui/hud/Toast.vue';
import TrainingPanel from './ui/hud/TrainingPanel.vue';
import ExtrasHud from './ui/hud/ExtrasHud.vue';
import Lobby from './ui/screens/Lobby.vue';
import MainMenu from './ui/screens/MainMenu.vue';
import PauseMenu from './ui/screens/PauseMenu.vue';
import Result from './ui/screens/Result.vue';
import { ui } from './ui/store';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const fxRef = ref<HTMLDivElement | null>(null);
let app: App | null = null;

onMounted(() => {
  if (canvasRef.value && fxRef.value) app = startApp(canvasRef.value, fxRef.value);
});

onBeforeUnmount(() => {
  app?.dispose();
  app = null;
});
</script>

<template>
  <canvas ref="canvasRef" class="game-canvas"></canvas>
  <div ref="fxRef" class="fx-layer"></div>
  <Hud />
  <BuildBar v-if="ui.screen === 'play'" />
  <Banner />
  <TrainingPanel />
  <ExtrasHud />
  <MainMenu />
  <Lobby />
  <PauseMenu />
  <Bench />
  <Cards />
  <Result />
  <Toast />
  <Transition name="fade">
    <div v-if="!ui.worldReady" class="loading" role="status" aria-live="polite">
      <div class="title">黎 明</div>
      <div class="bar"><i></i></div>
      <div class="note">正在加载地图…</div>
    </div>
  </Transition>
</template>

<style scoped>
.loading {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background: #05070a;
}
.title {
  font-size: 48px;
  letter-spacing: 24px;
  padding-left: 24px;
  color: #e8553f;
  font-weight: 800;
}
.bar {
  width: 220px;
  height: 3px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.bar i {
  display: block;
  width: 40%;
  height: 100%;
  background: #d9c9a0;
  animation: slide 1.2s ease-in-out infinite;
}
.note {
  font-size: 13px;
  letter-spacing: 4px;
  color: #7e8a96;
}
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .bar i { animation: none; width: 100%; }
}
.fade-leave-active {
  transition: opacity 0.35s;
}
.fade-leave-to {
  opacity: 0;
}
</style>
