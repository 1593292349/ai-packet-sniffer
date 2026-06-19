<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import AddressList from './components/AddressList.vue';
import SessionList from './components/SessionList.vue';
import ChatPanel from './components/ChatPanel.vue';
import AddAddressDialog from './components/AddAddressDialog.vue';
import RawDataView from './components/RawDataView.vue';
import { api } from './api';
import { parseRawViewId } from './rawView';
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
const rawViewId = parseRawViewId(window.location.search);
const lastDataError = ref('');

const showAddDialog = ref(false);

interface ProxyStatus {
  port: number;
  host: string;
  caPath: string;
  system: { enabled: boolean; host: string; port: number };
}

interface EnvStatus {
  HTTP_PROXY: string | null;
  HTTPS_PROXY: string | null;
  ALL_PROXY: string | null;
  NODE_EXTRA_CA_CERTS: string | null;
  REQUESTS_CA_BUNDLE: string | null;
  SSL_CERT_FILE: string | null;
}

const proxyStatus = ref<ProxyStatus | null>(null);
const proxyBusy = ref(false);
const lastProxyError = ref('');

const envStatus = ref<EnvStatus | null>(null);
const envBusy = ref(false);
const lastEnvMessage = ref('');

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
  try {
    proxyStatus.value = await api.proxy.status();
    envStatus.value = await api.proxy.envStatus();
  } catch (e: any) {
    lastProxyError.value = e?.message || String(e);
  }
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

async function deleteConversation(id: number) {
  lastDataError.value = '';
  try {
    await api.conversations.remove(id);
    await refreshAddresses();
    const addressId = selectedAddressId.value;
    if (addressId == null) return;
    const nextConversations: ConversationRow[] = await api.conversations.list(addressId);
    if (selectedAddressId.value !== addressId) return;
    conversations.value = nextConversations;
    if (
      selectedConversationId.value === id ||
      !nextConversations.some((conversation) => conversation.id === selectedConversationId.value)
    ) {
      selectedConversationId.value = nextConversations[0]?.id ?? null;
      if (selectedConversationId.value != null) {
        await loadMessages(selectedConversationId.value);
      } else {
        messages.value = [];
      }
    }
  } catch (e: any) {
    lastDataError.value = e?.message || String(e);
  }
}

async function clearConversations() {
  const addressId = selectedAddressId.value;
  if (addressId == null) return;
  lastDataError.value = '';
  try {
    await api.conversations.clear(addressId);
    await refreshAddresses();
    const nextConversations: ConversationRow[] = await api.conversations.list(addressId);
    if (selectedAddressId.value !== addressId) return;
    conversations.value = nextConversations;
    selectedConversationId.value = nextConversations[0]?.id ?? null;
    if (selectedConversationId.value != null) {
      await loadMessages(selectedConversationId.value);
    } else {
      messages.value = [];
    }
  } catch (e: any) {
    lastDataError.value = e?.message || String(e);
  }
}

async function loadMessages(id: number) {
  const nextMessages: MessageRow[] = await api.messages.list(id);
  if (selectedConversationId.value !== id) return;
  messages.value = nextMessages;
  requestAnimationFrame(() => {
    if (selectedConversationId.value !== id) return;
    const el = document.querySelector<HTMLElement>('#chat-body .message-scroller');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function onAdd(pattern: string, label: string) {
  await api.addresses.add(pattern, label);
  showAddDialog.value = false;
  await refreshAddresses();
}

async function onDelete(id: number) {
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

async function toggleSystemProxy() {
  if (proxyBusy.value) return;
  proxyBusy.value = true;
  lastProxyError.value = '';
  try {
    const result = proxyStatus.value?.system.enabled
      ? await api.proxy.disableSystem()
      : await api.proxy.enableSystem();
    if (result && result.ok === false) {
      lastProxyError.value = result.error || '操作失败';
    }
    await refreshProxy();
  } catch (e: any) {
    lastProxyError.value = e?.message || String(e);
  } finally {
    proxyBusy.value = false;
  }
}

/**
 * 一键永久写入 HTTP_PROXY 等环境变量到 HKCU\Environment
 * 写完后用户必须重启终端（hermes 这类 CLI 工具）才会生效
 */
async function toggleEnv(checked: boolean) {
  if (envBusy.value) return;
  envBusy.value = true;
  try {
    if (checked) {
      await api.proxy.setEnvPermanent();
    } else {
      await api.proxy.unsetEnvPermanent();
    }
    await refreshProxy();
  } catch (e: any) {
    lastEnvMessage.value = `✗ 错误：${e?.message || String(e)}`;
  } finally {
    envBusy.value = false;
  }
}

const envConfigured = computed(() => {
  if (!envStatus.value) return false;
  return !!(envStatus.value.HTTP_PROXY || envStatus.value.HTTPS_PROXY);
});

const envTooltip = computed(() => {
  if (!envStatus.value) return '读取中…';
  const s = envStatus.value;
  const lines: string[] = ['已设置环境变量：'];
  const add = (k: string, v: string | null) => {
    if (v) lines.push(`  ${k.padEnd(18)} ${v}`);
  };
  add('HTTP_PROXY', s.HTTP_PROXY);
  add('HTTPS_PROXY', s.HTTPS_PROXY);
  add('ALL_PROXY', s.ALL_PROXY);
  add('NODE_EXTRA_CA_CERTS', s.NODE_EXTRA_CA_CERTS);
  add('REQUESTS_CA_BUNDLE', s.REQUESTS_CA_BUNDLE);
  add('SSL_CERT_FILE', s.SSL_CERT_FILE);
  if (lines.length === 1) return '未设置\n\n打开开关自动写入代理变量\n写入后重开终端生效';
  return lines.join('\n') + '\n\n重开终端后生效';
});

onMounted(async () => {
  if (rawViewId != null) return;
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
  <RawDataView v-if="rawViewId != null" :raw-id="rawViewId" />
  <div v-else class="app">
    <div class="topbar">
      <div class="title">AI Packet Sniffer</div>
      <div class="spacer"></div>

      <!-- 系统代理开关 -->
      <a-switch
        :checked="proxyStatus?.system.enabled"
        :disabled="proxyBusy"
        @change="toggleSystemProxy"
        size="small"
      />
      <span :class="['label', 'sys', proxyStatus?.system.enabled ? 'on' : '']">
        {{ proxyStatus?.system.enabled ? `系统代理 :${proxyStatus.port}` : '系统代理' }}
      </span>

      <!-- CLI 环境变量开关 -->
      <a-tooltip :title="envTooltip" placement="bottom">
        <a-switch
          :checked="envConfigured"
          :disabled="envBusy"
          @change="toggleEnv"
          size="small"
        />
      </a-tooltip>
      <span class="label" :class="envConfigured ? 'on' : ''">环境变量</span>

      <span class="sep"></span>
      <a-button type="primary" size="small" @click="showAddDialog = true">+ 新增监听地址</a-button>
    </div>

    <!-- 状态提示条（只在有消息时显示） -->
    <div v-if="lastEnvMessage || lastProxyError || lastDataError" class="status-bar">
      <span v-if="lastEnvMessage" class="msg">{{ lastEnvMessage }}</span>
      <span v-if="lastProxyError" class="err">{{ lastProxyError }}</span>
      <span v-if="lastDataError" class="err">{{ lastDataError }}</span>
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
        @delete="deleteConversation"
        @clear="clearConversations"
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

<style scoped>
.sep {
  width: 1px;
  height: 18px;
  background: #ddd;
  margin: 0 2px;
}
.status-bar {
  background: #fffbe6;
  border-bottom: 1px solid #ffe58f;
  padding: 2px 14px;
  font-size: 12px;
  color: #664d03;
}
.status-bar .err {
  color: #c41e3a;
}
.label {
  font-size: 12px;
  color: var(--color-text-gray);
  margin-right: 8px;
  white-space: nowrap;
}
.label.on {
  color: #52c41a;
  font-weight: 600;
}
</style>