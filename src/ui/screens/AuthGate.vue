<script setup lang="ts">
import { ref } from 'vue';

/** 进游戏前的登录 / 注册（进度只存在线上，没账号玩不了） */
const props = defineProps<{ busy: boolean; error: string; submit: (name: string, password: string, register: boolean) => void }>();
const name = ref('');
const password = ref('');
const mode = ref<'login' | 'register'>('login');
const go = (): void => {
  if (!name.value.trim() || !password.value || props.busy) return;
  props.submit(name.value.trim(), password.value, mode.value === 'register');
};
</script>

<template>
  <div class="gate">
    <form class="box t-panel t-enter" @submit.prevent="go">
      <h1>黎 明</h1>
      <small class="code">DAWN · SURVIVAL PROTOCOL</small>
      <div class="t-seg tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ on: mode === 'login' }" @click="mode = 'login'">登 录</button>
        <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ on: mode === 'register' }" @click="mode = 'register'">注 册</button>
      </div>
      <label>
        <span>用户名</span>
        <input v-model="name" autocomplete="username" maxlength="20" placeholder="2–20 个字" autofocus />
      </label>
      <label>
        <span>密码</span>
        <input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="64" placeholder="至少 6 位" />
      </label>
      <button type="submit" class="t-btn primary go" :disabled="busy">{{ busy ? '…' : mode === 'login' ? '进 入' : '注册并进入' }}</button>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t-text);
  background: radial-gradient(ellipse at 50% 40%, #121a24, #05070a 70%);
}
.gate::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.015) 0 1px, transparent 1px 3px);
  pointer-events: none;
}
.box {
  width: min(380px, 90vw);
  display: grid;
  gap: 14px;
  padding: 30px 30px 26px;
  background: var(--t-panel-strong);
}
h1 {
  text-align: center;
  font-size: 46px;
  letter-spacing: 22px;
  padding-left: 22px;
  color: var(--t-red);
  text-shadow: 0 0 30px rgba(232, 85, 63, 0.45);
  font-weight: 800;
}
.code {
  margin: -10px 0 6px;
  text-align: center;
  font-family: var(--t-mono);
  font-size: 10px;
  letter-spacing: 4px;
  color: var(--t-dim);
}
label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
input {
  padding: 11px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--t-line-strong);
  color: var(--t-text);
  font: inherit;
  font-size: 15px;
  transition: border-color 0.15s var(--t-ease), box-shadow 0.15s var(--t-ease);
}
input:focus {
  outline: none;
  border-color: var(--t-gold);
  box-shadow: 0 0 14px rgba(240, 184, 58, 0.2);
}
.go {
  margin-top: 6px;
  padding: 12px;
  font-size: 15px;
  letter-spacing: 6px;
}
.go:disabled {
  cursor: wait;
}
.err {
  text-align: center;
  font-size: 13px;
  color: #ff7a62;
}
</style>
