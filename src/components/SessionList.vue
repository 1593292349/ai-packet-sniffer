<script setup lang="ts">
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import type { ConversationRow } from '../types';

const SESSION_ITEM_SIZE = 74;

const props = defineProps<{
  conversations: ConversationRow[];
  selectedId: number | null;
}>();

const emit = defineEmits<{
  select: [id: number];
  delete: [id: number];
  clear: [];
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
  return titleOf(c).slice(0, 1).toUpperCase();
}
</script>

<template>
  <div class="col-middle">
    <div class="header">
      <span>会话列表</span>
      <div class="session-header-actions">
        <a-tag color="blue">{{ conversations.length }}</a-tag>
        <a-popconfirm
          v-if="conversations.length > 0"
          title="确认清空当前地址的全部会话？"
          ok-text="清空"
          cancel-text="取消"
          @confirm="emit('clear')"
        >
          <a-button class="session-clear" size="small" type="link" danger>清空</a-button>
        </a-popconfirm>
      </div>
    </div>
    <a-empty v-if="conversations.length === 0" class="panel-empty" description="该地址还没有抓到对话">
      <template #description>
        <div>该地址还没有抓到对话</div>
        <div class="empty-hint">让使用本机代理的应用向该地址发起一次 AI 请求即可。</div>
      </template>
    </a-empty>
    <RecycleScroller
      v-else
      class="session-list"
      :items="props.conversations"
      :item-size="SESSION_ITEM_SIZE"
      key-field="id"
      v-slot="{ item: c }"
    >
      <a-card
        size="small"
        :class="['session-item', selectedId === c.id ? 'active' : '']"
        :body-style="{ padding: '10px 12px' }"
        @click="emit('select', c.id)"
      >
        <div class="avatar">{{ avatarOf(c) }}</div>
        <div class="body">
          <div class="row1">
            <span class="title">{{ titleOf(c) }}</span>
            <span class="time">{{ fmtTime(c.started_at) }}</span>
          </div>
          <div class="row2">
            <div class="preview">{{ c.preview || '(空)' }}</div>
            <a-popconfirm
              title="确认删除该会话及其原始数据？"
              ok-text="删除"
              cancel-text="取消"
              @confirm="emit('delete', c.id)"
            >
              <a-button class="session-delete" size="small" type="link" danger @click.stop>删除</a-button>
            </a-popconfirm>
          </div>
        </div>
      </a-card>
    </RecycleScroller>
  </div>
</template>
