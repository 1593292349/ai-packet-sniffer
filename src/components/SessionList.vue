<script setup lang="ts">
import type { ConversationRow } from '../types';

const props = defineProps<{
  conversations: ConversationRow[];
  selectedId: number | null;
}>();

const emit = defineEmits<{
  select: [id: number];
}>();

function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function titleOf(c: ConversationRow) {
  if (c.model) return c.model;
  try {
    const u = new URL(c.url);
    return u.pathname.replace(/^\/+/, '') || u.host;
  } catch {
    return c.url;
  }
}

function avatarOf(c: ConversationRow) {
  const t = titleOf(c);
  return t.slice(0, 1).toUpperCase();
}
</script>

<template>
  <div class="col-middle">
    <div class="header">会话列表（{{ conversations.length }}）</div>
    <div class="session-list">
      <div v-if="conversations.length === 0" class="empty">
        <div>该地址还没有抓到对话。</div>
        <div style="margin-top: 6px">
          让使用本机代理的应用向
          <br />
          <code style="background: #f0f0f0; padding: 1px 4px; border-radius: 2px"
            >该地址</code
          >
          发一次 AI 请求即可。
        </div>
      </div>
      <div
        v-for="c in conversations"
        :key="c.id"
        :class="['session-item', selectedId === c.id ? 'active' : '']"
        @click="emit('select', c.id)"
      >
        <div class="avatar">{{ avatarOf(c) }}</div>
        <div class="body">
          <div class="row1">
            <span class="title">{{ titleOf(c) }}</span>
            <span class="time">{{ fmtTime(c.started_at) }}</span>
          </div>
          <div class="preview">{{ c.preview || '(空)' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>