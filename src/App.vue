<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { startApp, type App } from './app/boot';
import Banner from './ui/Banner.vue';
import Bench from './ui/Bench.vue';
import BuildBar from './ui/BuildBar.vue';
import Cards from './ui/Cards.vue';
import Hud from './ui/Hud.vue';
import MainMenu from './ui/MainMenu.vue';
import PauseMenu from './ui/PauseMenu.vue';
import Result from './ui/Result.vue';
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
  <MainMenu />
  <PauseMenu />
  <Bench />
  <Cards />
  <Result />
</template>
