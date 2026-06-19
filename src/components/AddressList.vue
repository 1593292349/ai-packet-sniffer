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
      <a-tag color="blue">{{ addresses.length }}</a-tag>
    </div>
    <a-empty v-if="addresses.length === 0" class="panel-empty" description="还没有监听地址，点击右上角新增" />
    <div v-else class="address-list">
      <a-card
        v-for="a in addresses"
        :key="a.id"
        size="small"
        :class="['address-item', selectedId === a.id ? 'active' : '']"
        :body-style="{ padding: '10px 12px' }"
        @click="emit('select', a.id)"
      >
        <div class="pattern">{{ a.pattern }}</div>
        <div v-if="a.label" class="label">{{ a.label }}</div>
        <div class="meta">
          <a-tag :color="a.enabled ? 'green' : 'default'">{{ a.enabled ? '启用' : '停用' }}</a-tag>
          <a-tag>命中 {{ a.hit_count }}</a-tag>
          <span class="meta-time">{{ fmtTime(a.last_hit_at) }}</span>
        </div>
        <div class="row-actions" @click.stop>
          <a-button size="small" type="link" @click="emit('toggle', a.id, !a.enabled)">
            {{ a.enabled ? '停用' : '启用' }}
          </a-button>
          <a-popconfirm title="确认删除该监听地址及相关数据？" ok-text="删除" cancel-text="取消" @confirm="emit('delete', a.id)">
            <a-button size="small" type="link" danger>删除</a-button>
          </a-popconfirm>
        </div>
      </a-card>
    </div>
  </div>
</template>
