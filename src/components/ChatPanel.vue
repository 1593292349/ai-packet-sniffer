<script setup lang="ts">
import { computed } from 'vue';
import type { AddressRow, ConversationRow, MessageRow } from '../types';

const props = defineProps<{
  conversation: ConversationRow | null;
  messages: MessageRow[];
  address: AddressRow | null;
}>();

function avatarOf(role: string) {
  switch (role) {
    case 'user':
      return 'U';
    case 'assistant':
      return 'A';
    case 'system':
      return 'S';
    case 'tool':
      return 'T';
    default:
      return '?';
  }
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}

function renderText(text: string) {
  // 简单处理 ```code``` 块
  const parts: { type: 'text' | 'code' | 'inline'; content: string; lang?: string }[] = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) });
    parts.push({ type: 'code', content: m[2], lang: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });
  return parts;
}

const title = computed(() => {
  if (!props.conversation) return '';
  if (props.conversation.model) return props.conversation.model;
  try {
    return new URL(props.conversation.url).pathname;
  } catch {
    return props.conversation.url;
  }
});
</script>

<template>
  <div class="col-right">
    <div v-if="conversation" class="header">
      <div>
        <div class="title">{{ title }}</div>
        <div class="sub">{{ conversation.url }}</div>
      </div>
      <div class="stats">
        <span v-if="conversation.status">HTTP {{ conversation.status }}</span>
        <span v-if="conversation.input_tokens != null"
          >in {{ conversation.input_tokens }}</span
        >
        <span v-if="conversation.output_tokens != null"
          >out {{ conversation.output_tokens }}</span
        >
        <span>{{ conversation.message_count }} 条消息</span>
      </div>
    </div>
    <div :class="conversation ? 'chat-body' : 'chat-body'" id="chat-body">
      <div v-if="!conversation" class="chat-empty">
        <div style="text-align: center">
          <div style="font-size: 48px; opacity: 0.3">💬</div>
          <div style="margin-top: 12px">从左侧选择一个会话查看对话</div>
        </div>
      </div>
      <template v-else>
        <div v-if="messages.length === 0" class="chat-empty">
          （该会话没有解析出消息）
        </div>
        <div
          v-for="m in messages"
          :key="m.id"
          :class="['bubble-row', m.role]"
        >
          <div class="bubble-avatar">{{ avatarOf(m.role) }}</div>
          <div class="bubble-content">
            <div class="bubble-text">
              <template v-for="(p, i) in renderText(m.content)" :key="i">
                <pre v-if="p.type === 'code'" class="code-block"><code>{{ p.content }}</code></pre>
                <span v-else>{{ p.content }}</span>
              </template>
            </div>
            <div class="bubble-meta">
              {{ m.role }} · {{ fmtTime(m.ts) }}
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>