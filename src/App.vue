<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import AddressList from './components/AddressList.vue';
import SessionList from './components/SessionList.vue';
import ChatPanel from './components/ChatPanel.vue';
import AddAddressDialog from './components/AddAddressDialog.vue';
import { api } from './api';
import type {
  AddressRow,
  ConversationRow,
  MessageRow,
} from './types';

const addresses = ref<AddressRow[]>([]);
const selectedAddressId = ref<number | null>(null);
const conversations = ref<ConversationRow[]>([]);
const selectedConversationId = ref<number | null>(null);
const messages = ref<MessageRow[]>([]);

const showAddDialog = ref(false);
const showProxyCard = ref(true);

const proxyStatus = ref<{ port: number; host: string; caPath: string } | null>(null);
const systemProxyOn = ref(false);

const envLines = ref<string[]>([]);

const selectedAddress = computed(() =>
  addresses.value.find((a) => a.id === selectedAddressId.value) || null,
);
const selectedConversation = computed(() =>
  conversations.value.find((c) => c.id === selectedConversationId.value) || null,
);

async function refreshAddresses() {
  addresses.value = await api.addresses.list();
}

async function refreshProxy() {
  proxyStatus.value = await api.proxy.status();
  systemProxyOn.value = await api.proxy.isSystemEnabled();
  envLines.value = await api.proxy.envLines();
}

async function selectAddress(id: number) {
  selectedAddressId.value = id;
  conversations.value = await api.conversations.list(id);
  selectedConversationId.value = conversations.value[0]?.id ?? null;
  if (selectedConversationId.value) await loadMessages(selectedConversationId.value);
}

async function selectConversation(id: number) {
  selectedConversationId.value = id;
  await loadMessages(id);
}

async function loadMessages(id: number) {
  messages.value = await api.messages.list(id);
  // 滚动到底部
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-body');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function onAdd(pattern: string, label: string) {
  await api.addresses.add(pattern, label);
  showAddDialog.value = false;
  await refreshAddresses();
}

async function onDelete(id: number) {
  if (!confirm('确认删除该监听地址？相关会话也会一并删除。')) return;
  await api.addresses.remove(id);
  if (selectedAddressId.value === id) {
    selectedAddressId.value = null;
    conversations.value = [];
    selectedConversationId.value = null;
    messages.value = [];
  }
  await refreshAddresses();
}

async function onToggle(id: number, enabled: boolean) {
  await api.addresses.toggle(id, enabled);
  await refreshAddresses();
}

async function enableSystemProxy() {
  await api.proxy.enableSystem();
  await refreshProxy();
}
async function disableSystemProxy() {
  await api.proxy.disableSystem();
  await refreshProxy();
}
async function copyEnv() {
  await navigator.clipboard.writeText(envLines.value.join('\r\n'));
  alert('环境变量已复制到剪贴板。在新打开的终端里粘贴即可。');
}
async function openCaFolder() {
  await api.ca.openFolder();
}
async function exportDer() {
  await api.ca.exportDer();
}

onMounted(async () => {
  await refreshProxy();
  await refreshAddresses();
  if (addresses.value.length > 0) {
    await selectAddress(addresses.value[0].id);
  }
  api.on('capture:new', async () => {
    if (selectedAddressId.value != null) {
      conversations.value = await api.conversations.list(selectedAddressId.value);
      if (
        !selectedConversationId.value ||
        !conversations.value.find((c) => c.id === selectedConversationId.value)
      ) {
        selectedConversationId.value = conversations.value[0]?.id ?? null;
        if (selectedConversationId.value) await loadMessages(selectedConversationId.value);
      }
    }
    await refreshAddresses();
  });
});
</script>

<template>
  <div class="app">
    <div class="topbar">
      <div class="title">AI Packet Sniffer</div>
      <div class="spacer"></div>
      <div class="status">
        <span :class="['dot', proxyStatus ? '' : 'off']"></span>
        <span v-if="proxyStatus">代理 127.0.0.1:{{ proxyStatus.port }} 运行中</span>
        <span v-else>代理未启动</span>
      </div>
      <button class="btn ghost small" @click="refreshProxy">刷新状态</button>
      <button class="btn small" @click="showAddDialog = true">+ 新增监听地址</button>
    </div>

    <div v-if="showProxyCard && proxyStatus" class="proxy-card">
      <div class="grow">
        抓包说明：HTTP 走系统代理；HTTPS 需先安装本工具的 CA 证书。
        <span v-if="!systemProxyOn">系统代理未开启（仅手动配置 HTTP_PROXY 的进程会被抓到）。</span>
        <span v-else>系统代理已开启（netsh winhttp）。</span>
      </div>
      <button v-if="!systemProxyOn" class="btn small" @click="enableSystemProxy">开启系统代理</button>
      <button v-else class="btn ghost small" @click="disableSystemProxy">关闭系统代理</button>
      <button class="btn ghost small" @click="openCaFolder">打开 CA 文件夹</button>
      <button class="btn ghost small" @click="exportDer">导出 CA（双击安装）</button>
      <button class="btn ghost small" @click="copyEnv">复制 CLI 环境变量</button>
      <button class="btn ghost small" @click="showProxyCard = false">收起</button>
    </div>

    <div class="main">
      <AddressList
        :addresses="addresses"
        :selected-id="selectedAddressId"
        @select="selectAddress"
        @delete="onDelete"
        @toggle="onToggle"
      />
      <SessionList
        :conversations="conversations"
        :selected-id="selectedConversationId"
        @select="selectConversation"
      />
      <ChatPanel
        :conversation="selectedConversation"
        :messages="messages"
        :address="selectedAddress"
      />
    </div>

    <AddAddressDialog
      v-if="showAddDialog"
      @close="showAddDialog = false"
      @submit="onAdd"
    />
  </div>
</template>