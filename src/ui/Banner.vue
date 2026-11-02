<script setup lang="ts">
import { ui } from './store';
</script>

<template>
  <div v-if="ui.banner.text && (ui.screen === 'play' || ui.screen === 'cards')" :key="ui.banner.id" class="banner" :class="{ day: !ui.banner.text.includes('夜') }">
    <div class="t">{{ ui.banner.text }}</div>
    <div class="s">{{ ui.banner.sub }}</div>
  </div>
</template>

<style scoped>
.banner {
  position: fixed;
  left: 50%;
  top: 24%;
  transform: translateX(-50%);
  z-index: 30;
  pointer-events: none;
  text-align: center;
  min-width: 620px;
  padding: 18px 60px 20px;
  background: linear-gradient(90deg, rgba(4, 6, 9, 0), rgba(4, 6, 9, 0.72) 22%, rgba(4, 6, 9, 0.72) 78%, rgba(4, 6, 9, 0));
  animation: show 3.6s ease both;
  text-shadow: 0 0 24px rgba(0, 0, 0, 0.9), 0 2px 6px #000;
}
.banner.day .t {
  color: #f0c85a;
}
.t {
  font-size: 40px;
  letter-spacing: 16px;
  color: #e8553f;
  font-weight: 700;
  padding-left: 16px;
}
.s {
  margin-top: 10px;
  font-size: 14px;
  letter-spacing: 6px;
  color: #cfd6de;
}
@keyframes show {
  0% {
    opacity: 0;
    transform: translateX(-50%) scale(1.15);
  }
  10% {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
  75% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>
