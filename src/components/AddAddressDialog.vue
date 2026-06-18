<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  close: [];
  submit: [pattern: string, label: string];
}>();

const pattern = ref('');
const label = ref('');

const presets = [
  { p: 'https://api.minimaxi.com/anthropic', l: 'minimax anthropic' },
  { p: 'https://api.openai.com', l: 'openai' },
  { p: 'https://api.anthropic.com', l: 'anthropic' },
  { p: 'https://generativelanguage.googleapis.com', l: 'gemini' },
];

function submit() {
  if (!pattern.value.trim()) return;
  emit('submit', pattern.value.trim(), label.value.trim());
}
function pick(p: string, l: string) {
  pattern.value = p;
  label.value = l;
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span>新增监听地址</span>
        <button class="btn ghost small" @click="emit('close')">关闭</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>监听 URL</label>
          <input
            v-model="pattern"
            placeholder="例如：https://api.minimaxi.com/anthropic"
            autofocus
            @keyup.enter="submit"
          />
          <div class="hint">
            支持 origin（https://api.xx.com）或带 path 前缀。匹配该 origin 下所有请求。
          </div>
        </div>
        <div class="field">
          <label>备注（可选）</label>
          <input v-model="label" placeholder="例如：minimax anthropic 入口" />
        </div>
        <div class="field">
          <label>常用预设</label>
          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <button
              v-for="ps in presets"
              :key="ps.p"
              class="btn ghost small"
              @click="pick(ps.p, ps.l)"
              type="button"
            >
              {{ ps.l }}
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn ghost small" @click="emit('close')">取消</button>
        <button class="btn" @click="submit">添加</button>
      </div>
    </div>
  </div>
</template>