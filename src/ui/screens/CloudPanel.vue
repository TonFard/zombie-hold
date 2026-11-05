<script setup lang="ts">
import { computed, ref } from 'vue';
import { ui } from '../store';

const name = ref('');
const password = ref('');
const c = computed(() => ui.cloud);
const syncedAt = computed(() => (c.value.syncedAt ? new Date(c.value.syncedAt).toLocaleString() : '还没同步'));
const submit = (register: boolean): void => {
  if (!name.value.trim() || !password.value) return;
  ui.actions.cloudSignIn(name.value, password.value, register);
};
</script>

<template>
  <div class="cloud">
    <h3>云存档</h3>
    <template v-if="c.name">
      <p class="who"><b>{{ c.name }}</b> · 已同步 {{ syncedAt }}</p>
      <div class="row">
        <button :disabled="c.busy" @click="ui.actions.cloudUpload()">上传</button>
        <button :disabled="c.busy" @click="ui.actions.cloudDownload()">下载</button>
        <button class="ghost" :disabled="c.busy" @click="ui.actions.cloudSignOut()">退出</button>
      </div>
    </template>
    <form v-else class="form" @submit.prevent="submit(false)">
      <label>
        <span>用户名</span>
        <input v-model="name" autocomplete="username" maxlength="20" placeholder="2–20 个字" />
      </label>
      <label>
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="current-password" maxlength="64" placeholder="至少 6 位" />
      </label>
      <div class="row">
        <button type="submit" :disabled="c.busy">登 录</button>
        <button type="button" class="ghost" :disabled="c.busy" @click="submit(true)">注 册</button>
      </div>
    </form>
    <p v-if="c.busy" class="hint">…</p>
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
.who {
  font-size: 14px;
  color: #c9d2da;
}
.who b {
  color: #f0b83a;
}
.form {
  display: grid;
  gap: 10px;
  max-width: 420px;
}
label {
  display: grid;
  grid-template-columns: 70px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #8f9aa6;
}
input {
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid #2c3a48;
  color: #e8eef4;
  font: inherit;
}
input:focus {
  outline: none;
  border-color: #6fd0e8;
}
.row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
button {
  padding: 8px 18px;
  background: rgba(240, 184, 58, 0.1);
  border: 1px solid #8a6a20;
  color: #f0c85a;
  font: inherit;
  font-size: 13px;
  letter-spacing: 2px;
  cursor: pointer;
}
button.ghost {
  background: transparent;
  border-color: #3a4a5a;
  color: #a9b8c8;
}
button:disabled {
  opacity: 0.4;
  cursor: wait;
}
.hint {
  margin-top: 8px;
  font-size: 12px;
  color: #7e8a96;
}
.err {
  margin-top: 8px;
  font-size: 13px;
  color: #ff7a62;
}
</style>
