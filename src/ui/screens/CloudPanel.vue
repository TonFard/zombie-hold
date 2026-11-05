<script setup lang="ts">
import { computed } from 'vue';
import { ui } from '../store';

const c = computed(() => ui.cloud);
</script>

<template>
  <div class="cloud">
    <h3>账 号</h3>
    <div class="row">
      <span class="who"><b>{{ c.name }}</b> · 进度自动保存到线上</span>
      <button class="ghost" :disabled="c.busy" @click="ui.actions.cloudSignOut()">退出登录</button>
    </div>
    <p v-if="c.error" class="err" role="alert">{{ c.error }}</p>
  </div>
</template>

<style scoped>
.cloud {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
h3 {
  font-size: 13px;
  letter-spacing: 6px;
  color: #6fd0e8;
  margin-bottom: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.who {
  font-size: 13px;
  color: #8f9aa6;
}
.who b {
  font-size: 15px;
  color: #f0b83a;
}
button {
  padding: 8px 18px;
  background: transparent;
  border: 1px solid #3a4a5a;
  color: #a9b8c8;
  font: inherit;
  font-size: 13px;
  letter-spacing: 2px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: #e8553f;
  color: #fff;
}
button:disabled {
  opacity: 0.4;
  cursor: wait;
}
.err {
  margin-top: 8px;
  font-size: 13px;
  color: #ff7a62;
}
</style>
