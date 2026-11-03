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
</template>
