<script setup lang="ts">
import { ui } from '../store';
</script>

<template>
  <div v-if="ui.toast.text" :key="ui.toast.id" class="toast" :class="{ warn: ui.toast.warn }" role="status">{{ ui.toast.text }}</div>
</template>

<style scoped>
/* 放在左下生命条上方：右下是武器和技能格，不再叠在一起 */
.toast {
  position: fixed;
  left: 24px;
  bottom: 112px;
  z-index: 90;
  pointer-events: none;
  max-width: 380px;
  padding: 7px 14px 7px 12px;
  background: linear-gradient(90deg, var(--hud-panel-strong), rgba(9, 13, 18, 0.4));
  border-left: 2px solid var(--hud-cyan);
  font-family: var(--hud-font);
  color: var(--hud-text);
  font-size: 13px;
  letter-spacing: 1px;
  text-shadow: var(--hud-shadow);
  animation: toast 3.2s ease both;
}
.toast.warn {
  border-left-color: var(--hud-danger);
  color: #ffb4a4;
}
@keyframes toast {
  0% {
    opacity: 0;
    transform: translateX(-12px);
  }
  8%,
  80% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}
</style>
