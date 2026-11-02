<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { startApp, type App } from './app/boot';
import BuildBar from './ui/BuildBar.vue';
import Hud from './ui/Hud.vue';

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
  <BuildBar />
</template>
