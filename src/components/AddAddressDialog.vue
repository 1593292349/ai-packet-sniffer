<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  close: [];
  submit: [pattern: string, label: string];
}>();

const pattern = ref('');
const label = ref('');

const presets = [
  { p: 'https://soul.mixiaoxiao.com/v1', l: 'soul mixiaoxiao' },
  { p: 'https://api.minimaxi.com/anthropic', l: 'minimax anthropic' },
  { p: 'https://api.openai.com/v1', l: 'openai' },
  { p: 'https://api.anthropic.com', l: 'anthropic' },
  { p: 'https://generativelanguage.googleapis.com', l: 'gemini' },
];

function submit() {
  const value = pattern.value.trim();
  if (!value) return;
  emit('submit', value, label.value.trim());
}
function pick(p: string, l: string) {
  pattern.value = p;
  label.value = l;
}
</script>

<template>
  <a-modal
    :open="true"
    title="新增监听地址"
    width="560px"
    ok-text="添加"
    cancel-text="取消"
    :ok-button-props="{ disabled: !pattern.trim() }"
    @ok="submit"
    @cancel="emit('close')"
  >
    <a-form layout="vertical" class="add-address-form">
      <a-form-item label="监听 URL" required>
        <a-input
          v-model:value="pattern"
          placeholder="例如：https://soul.mixiaoxiao.com/v1"
          autofocus
          allow-clear
          @press-enter="submit"
        />
        <div class="form-hint">支持 origin 或带 path 前缀；按 origin + path 前缀匹配请求。</div>
      </a-form-item>

      <a-form-item label="备注（可选）">
        <a-input v-model:value="label" placeholder="例如：soul mixiaoxiao 入口" allow-clear />
      </a-form-item>

      <a-form-item label="常用预设">
        <a-space wrap size="small">
          <a-button v-for="ps in presets" :key="ps.p" size="small" @click="pick(ps.p, ps.l)">
            {{ ps.l }}
          </a-button>
        </a-space>
      </a-form-item>
    </a-form>
  </a-modal>
</template>
