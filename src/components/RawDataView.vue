<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import type { RawRow } from '../types';
import { formatRawText, isStructuredRawText } from '../rawView';

const props = defineProps<{
  rawId: number;
}>();

const rawData = ref<RawRow | null>(null);
const loading = ref(true);
const error = ref('');
const activeTab = ref<RawTabKey>('reqHeaders');
const reqHeadersWrap = ref<HTMLDivElement | null>(null);
const bodyWrap = ref<HTMLDivElement | null>(null);
const respHeadersWrap = ref<HTMLDivElement | null>(null);
const respBodyWrap = ref<HTMLDivElement | null>(null);
let bodyEditor: EditorView | null = null;
let editorGeneration = 0;

type RawTabKey = 'reqHeaders' | 'reqBody' | 'respHeaders' | 'respBody';

async function loadRaw() {
  try {
    const data = await window.rawSniffer.get();
    if (!data) throw new Error('原始数据不存在或已被删除');
    if (data.id !== props.rawId) throw new Error('原始数据窗口与记录不匹配');
    rawData.value = data;
    document.title = `原始请求 / 响应 #${data.id}`;
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
  if (rawData.value) await onTabChange('reqHeaders');
}

async function onTabChange(key: string) {
  if (!isRawTabKey(key)) return;
  activeTab.value = key;
  const generation = ++editorGeneration;
  bodyEditor?.destroy();
  bodyEditor = null;
  await initRawEditor(key, generation);
}

function isRawTabKey(key: string): key is RawTabKey {
  return key === 'reqHeaders' || key === 'reqBody' || key === 'respHeaders' || key === 'respBody';
}

function getRawText(key: RawTabKey): string | null {
  if (!rawData.value) return null;
  if (key === 'reqHeaders') return rawData.value.req_headers;
  if (key === 'reqBody') return rawData.value.req_body;
  if (key === 'respHeaders') return rawData.value.resp_headers;
  return rawData.value.resp_body;
}

function getEditorParent(key: RawTabKey): HTMLDivElement | null {
  if (key === 'reqHeaders') return reqHeadersWrap.value;
  if (key === 'reqBody') return bodyWrap.value;
  if (key === 'respHeaders') return respHeadersWrap.value;
  return respBodyWrap.value;
}

async function initRawEditor(key: RawTabKey, generation: number) {
  if (bodyEditor || !rawData.value) return;
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  if (generation !== editorGeneration || !rawData.value) return;
  const parent = getEditorParent(key);
  if (!parent) return;
  const source = getRawText(key);
  const content = formatRawText(source);
  if (!content) return;
  const structured = isStructuredRawText(source);
  const state = EditorState.create({
    doc: content,
    extensions: [
      ...(structured ? [basicSetup, json(), EditorView.lineWrapping] : []),
      EditorView.theme({
        '&': { fontSize: '13px', height: '100%' },
        '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', Consolas, Menlo, monospace" },
        '.cm-gutters': { backgroundColor: '#fff', color: 'var(--color-text-gray)', borderRight: 'none' },
        '.cm-activeLine': { backgroundColor: 'rgba(234, 244, 255, 0.45)' },
        '.cm-activeLineGutter': { backgroundColor: 'rgba(234, 244, 255, 0.45)' },
        '.cm-content': { padding: '8px 0' },
        '.cm-line': { lineHeight: '1.6' },
      }),
      EditorView.baseTheme({
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: '#b7d7ff',
        },
        '& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: '#b7d7ff',
        },
        '&.cm-focused .cm-activeLine': {
          backgroundColor: 'transparent',
        },
        '&.cm-focused .cm-activeLineGutter': {
          backgroundColor: 'transparent',
        },
      }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  bodyEditor = new EditorView({ state, parent });
  await nextTick();
  requestAnimationFrame(() => bodyEditor?.requestMeasure());
}

onMounted(loadRaw);
onBeforeUnmount(() => {
  editorGeneration++;
  bodyEditor?.destroy();
});
</script>

<template>
  <div class="raw-window">
    <div class="raw-window-title">原始请求 / 响应</div>
    <div v-if="loading" class="raw-window-state"><a-spin /></div>
    <a-result v-else-if="error" status="error" title="原始数据加载失败" :sub-title="error" />
    <template v-else-if="rawData">
      <div class="raw-summary">
        <div class="raw-summary-url">{{ rawData.method }} {{ rawData.url }}</div>
        <div class="raw-summary-tags">
          <a-tag v-if="rawData.resp_status != null" :color="rawData.resp_status < 400 ? 'green' : 'red'">{{ rawData.resp_status }}</a-tag>
          <a-tag>{{ rawData.protocol }}</a-tag>
        </div>
      </div>
      <a-tabs
        v-model:activeKey="activeTab"
        class="raw-tabs"
        :tabBarStyle="{ margin: '0 16px' }"
        @change="onTabChange"
      >
        <a-tab-pane key="reqHeaders" tab="请求头" class="raw-tab-pane">
          <div ref="reqHeadersWrap" class="cm-container"></div>
        </a-tab-pane>
        <a-tab-pane key="reqBody" tab="请求体" class="raw-tab-pane">
          <div ref="bodyWrap" class="cm-container"></div>
        </a-tab-pane>
        <a-tab-pane key="respHeaders" tab="响应头" class="raw-tab-pane">
          <div ref="respHeadersWrap" class="cm-container"></div>
        </a-tab-pane>
        <a-tab-pane key="respBody" tab="响应体" class="raw-tab-pane">
          <div ref="respBodyWrap" class="cm-container"></div>
        </a-tab-pane>
      </a-tabs>
    </template>
  </div>
</template>
