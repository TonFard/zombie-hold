<script setup lang="ts">
import { ICONS, type IconName } from './icons';

/** 菜单里的线条图标：大小跟字号走（1em），颜色跟文字走。图形在 icons.ts */
defineProps<{ name: IconName }>();
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 内容是 icons.ts 里写死的路径，不是用户输入 -->
  <svg class="t-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS[name]"></svg>
</template>
