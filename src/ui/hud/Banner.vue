<script setup lang="ts">
import { ui } from '../store';
</script>

<template>
  <div v-if="ui.banner.text && (ui.screen === 'play' || ui.screen === 'training' || ui.screen === 'cards')" :key="ui.banner.id" class="banner" :class="{ day: !ui.banner.text.includes('夜') }">
    <i class="ln"></i>
    <div class="t">{{ ui.banner.text }}</div>
    <div class="s">{{ ui.banner.sub }}</div>
    <i class="ln"></i>
  </div>
</template>

<style scoped>
/* 横贯屏幕的一条暗带，上下两道渐隐细线；夜晚 / 首领用红色，白天用琥珀色 */
.banner {
  --tone: var(--hud-danger);
  position: fixed;
  left: 0;
  right: 0;
  top: 22%;
  z-index: 30;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  font-family: var(--hud-font);
  text-align: center;
  background: linear-gradient(90deg, rgba(4, 6, 9, 0), rgba(4, 6, 9, 0.66) 30%, rgba(4, 6, 9, 0.66) 70%, rgba(4, 6, 9, 0));
  animation: show 3.6s ease both;
  text-shadow: 0 0 20px rgba(0, 0, 0, 0.8), var(--hud-shadow);
}
.banner.day {
  --tone: var(--hud-accent);
}
.ln {
  width: 380px;
  max-width: 60vw;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--tone), transparent);
}
.t {
  margin-top: 10px;
  padding-left: 14px;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: 14px;
  color: var(--tone);
}
.s {
  margin: 4px 0 10px;
  font-size: 13px;
  letter-spacing: 4px;
  color: var(--hud-text);
}
@keyframes show {
  0% {
    opacity: 0;
    transform: scaleY(0.4);
  }
  8% {
    opacity: 1;
    transform: none;
  }
  78% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>
