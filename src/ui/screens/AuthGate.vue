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
    <form class="box" @submit.prevent="go">
      <h1>黎 明</h1>
      <div class="tabs" role="tablist">
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
      <button type="submit" class="go" :disabled="busy">{{ busy ? '…' : mode === 'login' ? '进 入' : '注册并进入' }}</button>
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
  background: radial-gradient(ellipse at center, #0c1118, #05070a);
}
.box {
  width: min(360px, 90vw);
  display: grid;
  gap: 14px;
}
h1 {
  text-align: center;
  font-size: 46px;
  letter-spacing: 22px;
  padding-left: 22px;
  margin-bottom: 10px;
  color: #e8553f;
  font-weight: 800;
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid #243240;
}
.tabs button {
  padding: 10px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #7e8a96;
  font: inherit;
  font-size: 14px;
  letter-spacing: 4px;
  cursor: pointer;
}
.tabs button.on {
  color: #f0b83a;
  border-bottom-color: #f0b83a;
}
label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  letter-spacing: 2px;
  color: #8f9aa6;
}
input {
  padding: 11px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid #2c3a48;
  color: #e8eef4;
  font: inherit;
  font-size: 15px;
}
input:focus {
  outline: none;
  border-color: #f0b83a;
}
.go {
  margin-top: 6px;
  padding: 12px;
  background: rgba(232, 85, 63, 0.14);
  border: 1px solid #e8553f;
  color: #fff;
  font: inherit;
  font-size: 15px;
  letter-spacing: 6px;
  cursor: pointer;
}
.go:hover:not(:disabled) {
  background: #e8553f;
}
.go:disabled {
  opacity: 0.5;
  cursor: wait;
}
.err {
  text-align: center;
  font-size: 13px;
  color: #ff7a62;
}
</style>
