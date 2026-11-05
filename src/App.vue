<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { startApp, type App } from './app/boot';
import { AuthError, CloudStore, clearAuth, loadAuth, pull, signIn, type CloudAuth } from './app/cloud';
import AuthGate from './ui/screens/AuthGate.vue';
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
const appRef = ref<App | null>(null);
let app: App | null = null;

// ---- 线上存档：先登录、把进度从服务器拉下来，再启动游戏 ----
const needLogin = ref(false);
const authBusy = ref(false);
const authError = ref('');

const boot = async (auth: CloudAuth): Promise<void> => {
  authBusy.value = true;
  authError.value = '';
  try {
    const store = new CloudStore(auth);
    store.hydrate(await pull(auth));
    needLogin.value = false;
    if (canvasRef.value && fxRef.value) app = appRef.value = startApp(canvasRef.value, fxRef.value, auth, store);
  } catch (e) {
    if (e instanceof AuthError) clearAuth();
    needLogin.value = true;
    authError.value = e instanceof AuthError ? '登录已过期' : (e as Error).message;
  } finally {
    authBusy.value = false;
  }
};

const submit = (name: string, password: string, register: boolean): void => {
  authBusy.value = true;
  authError.value = '';
  signIn(name, password, register)
    .then((a) => boot(a))
    .catch((e: Error) => {
      authError.value = e.message;
      authBusy.value = false;
    });
};

onMounted(() => {
  const a = loadAuth();
  if (a) void boot(a);
  else needLogin.value = true;
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
  <AuthGate v-if="needLogin" :busy="authBusy" :error="authError" :submit="submit" />
  <Transition name="fade">
    <div v-if="!needLogin && (!appRef || !ui.worldReady)" class="loading" role="status" aria-live="polite">
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
