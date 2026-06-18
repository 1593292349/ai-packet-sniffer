<script setup lang="ts">
import type { AddressRow } from '../types';

defineProps<{
  addresses: AddressRow[];
  selectedId: number | null;
}>();

const emit = defineEmits<{
  select: [id: number];
  delete: [id: number];
  toggle: [id: number, enabled: boolean];
}>();

function fmtTime(ts: number | null) {
  if (!ts) return '—';
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
</script>

<template>
  <div class="col-left">
    <div class="header">
      <span>监听地址</span>
      <span style="font-size: 11px; color: #888">{{ addresses.length }}</span>
    </div>
    <div class="address-list">
      <div v-if="addresses.length === 0" class="empty">
        还没有监听地址，点击右上「+ 新增监听地址」开始抓包。
      </div>
      <div
        v-for="a in addresses"
        :key="a.id"
        :class="['address-item', selectedId === a.id ? 'active' : '']"
        @click="emit('select', a.id)"
      >
        <div class="pattern">{{ a.pattern }}</div>
        <div v-if="a.label" class="label">{{ a.label }}</div>
        <div class="meta">
          <span>{{ a.enabled ? '启用' : '已停用' }}</span>
          <span>命中 {{ a.hit_count }}</span>
          <span v-if="a.last_hit_at">{{ fmtTime(a.last_hit_at) }}</span>
        </div>
        <div class="row-actions">
          <button @click.stop="emit('toggle', a.id, !a.enabled)">
            {{ a.enabled ? '停用' : '启用' }}
          </button>
          <button @click.stop="emit('delete', a.id)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>