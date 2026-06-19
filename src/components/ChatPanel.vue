<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { AddressRow, ConversationRow, MessageRow } from '../types';
import { api } from '../api';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import MarkdownIt from 'markdown-it';
import ToolResultView from './ToolResultView.vue';

const props = defineProps<{
  conversation: ConversationRow | null;
  messages: MessageRow[];
  address: AddressRow | null;
}>();

const rawLoading = ref(false);
const rawOpenError = ref('');
const expandedCards = ref<Record<string, boolean>>({});
interface ScrollerCacheSnapshot {
  keys: Array<string | number>;
  sizes: Array<number | null>;
}
const messageScroller = ref<{
  cacheSnapshot: ScrollerCacheSnapshot;
  restoreCache: (snapshot: ScrollerCacheSnapshot) => boolean;
  forceUpdate: (clear?: boolean) => void;
} | null>(null);
let rawOpenGeneration = 0;

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});
const metaCache = new WeakMap<MessageRow, { raw: string | null; value: Record<string, any> }>();
const toolArgsCache = new WeakMap<MessageRow, { raw?: string; value: Record<string, unknown> }>();
interface ToolCallSummary {
  name: string;
  primary: string;
  detail: string;
  params: Array<{ name: string; value: string }>;
}
const toolCallSummaryCache = new WeakMap<MessageRow, { name: string; raw: string; value: ToolCallSummary }>();

function renderMarkdown(text: string) {
  return md
    .render((text || '').trim())
    .replace(/(?:<p>\s*<\/p>|<br\s*\/?>|\s)+$/giu, '');
}

function parseMeta(m: MessageRow): Record<string, any> {
  const cached = metaCache.get(m);
  if (cached?.raw === m.meta) return cached.value;
  let value: Record<string, any> = {};
  if (m.meta) {
    try { value = JSON.parse(m.meta); } catch { /* 保持空对象 */ }
  }
  metaCache.set(m, { raw: m.meta, value });
  return value;
}

function getReasoning(m: MessageRow): string {
  const reasoning = parseMeta(m).reasoning;
  return typeof reasoning === 'string' ? reasoning.trim() : '';
}

watch(() => props.conversation?.id, () => {
  rawOpenGeneration++;
  rawLoading.value = false;
  expandedCards.value = {};
  rawOpenError.value = '';
});

const chatMessages = computed(() => props.messages);

async function loadRaw() {
  const rawId = props.conversation?.raw_request_id;
  if (!rawId) return;
  const generation = ++rawOpenGeneration;
  rawLoading.value = true;
  rawOpenError.value = '';
  try {
    await api.raw.open(rawId);
  } catch (e) {
    if (generation !== rawOpenGeneration) return;
    rawOpenError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (generation === rawOpenGeneration) rawLoading.value = false;
  }
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function pad(n: number) { return String(n).padStart(2, '0'); }

function isExpanded(key: string) {
  const expanded = expandedCards.value[key];
  return expanded == null ? key.startsWith('thinking-') : expanded;
}
async function toggleExpanded(key: string, itemKey: string, event: MouseEvent) {
  const itemElement = (event.currentTarget as HTMLElement)
    .closest('.msg-row')
    ?.parentElement;
  expandedCards.value = { ...expandedCards.value, [key]: !isExpanded(key) };
  await nextTick();
  if (!itemElement?.isConnected || !messageScroller.value) return;

  const snapshot = messageScroller.value.cacheSnapshot;
  const index = snapshot.keys.indexOf(itemKey);
  const height = Math.trunc(itemElement.getBoundingClientRect().height);
  if (index < 0 || height <= 0 || snapshot.sizes[index] === height) return;

  const sizes = snapshot.sizes.slice();
  sizes[index] = height;
  messageScroller.value.restoreCache({ keys: snapshot.keys.slice(), sizes });
  messageScroller.value.forceUpdate();
}
function summaryText(text: string, max = 90) {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function renderText(text: string) {
  const normalized = (text || '').trim();
  const parts: { type: 'text' | 'code' ; content: string; lang?: string }[] = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: normalized.slice(last, m.index) });
    parts.push({ type: 'code', content: m[2], lang: m[1] });
    last = m.index + m[0].length;
  }
  if (last < normalized.length) parts.push({ type: 'text', content: normalized.slice(last) });
  return parts;
}

function isSystemRole(role: string) {
  return role === 'system' || role === 'developer';
}

function isToolCall(m: MessageRow, next?: MessageRow) {
  if (m.role !== 'assistant') return false;
  if (m.content.startsWith('[tool_use]')) return true;
  if (!m.content.trim() && !getReasoning(m) && next?.role === 'tool') return true;
  const meta = parseMeta(m);
  return Boolean(meta.name || meta.tool_calls || meta.toolCalls || meta.toolCallsText);
}
function getToolMeta(m: MessageRow): { name?: string; args?: string } {
  const meta = parseMeta(m);
  if (meta.name || meta.args) return { name: meta.name, args: meta.args };
  const calls = meta.tool_calls || meta.toolCalls;
  const first = Array.isArray(calls) ? calls[0] : calls;
  const fn = first?.function || first;
  return {
    name: fn?.name || first?.name,
    args: typeof fn?.arguments === 'string' ? fn.arguments : prettyJson(fn?.arguments || first?.input),
  };
}

function getToolCallIdentity(m: MessageRow): { id?: string; name?: string } {
  const meta = parseMeta(m);
  const calls = meta.tool_calls || meta.toolCalls;
  const first = Array.isArray(calls) ? calls[0] : calls;
  const fn = first?.function || first;
  return {
    id: meta.call_id || meta.id || first?.call_id || first?.id,
    name: meta.name || fn?.name || first?.name,
  };
}

function getToolResultIdentity(m: MessageRow): { id?: string; name?: string } {
  const meta = parseMeta(m);
  return {
    id: meta.tool_call_id || meta.tool_use_id || meta.call_id,
    name: meta.name,
  };
}

function toolResultSource(m: MessageRow): string {
  const metaName = getToolResultIdentity(m).name;
  if (metaName) return metaName;
  const normalized = m.content.replace(/^\[tool_result\]\s*/u, '').trim();
  return normalized.match(/^<untrusted_tool_result source="([^"]+)">/u)?.[1]
    || normalized.match(/^\[([a-zA-Z_][\w-]*)\]/u)?.[1]
    || 'tool';
}

function toolName(call: MessageRow, results: MessageRow[]) {
  const meta = getToolMeta(call);
  if (meta.name) return meta.name;
  const firstResult = results[0];
  if (firstResult) return toolResultSource(firstResult);
  return call.content.replace('[tool_use] ', '') || 'tool';
}
function parseToolArgs(call: MessageRow): Record<string, unknown> {
  const raw = getToolMeta(call).args;
  const cached = toolArgsCache.get(call);
  if (cached && cached.raw === raw) return cached.value;
  let value: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed;
    } catch { /* 保持空对象 */ }
  }
  toolArgsCache.set(call, { raw, value });
  return value;
}
function callValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.map(String).join('、').trim();
  if (typeof value === 'object') return '';
  return String(value).trim();
}
function callDetail(parts: Array<string | null | undefined | false>): string {
  return parts
    .filter(Boolean)
    .join('　');
}
function labeledCallValue(label: string, value: unknown, suffix = ''): string {
  const text = callValue(value);
  return text ? `${label}：${text}${suffix}` : '';
}
function skillActionLabel(action: unknown): string {
  const value = callValue(action);
  return ({
    create: '创建',
    patch: '更新',
    edit: '编辑',
    delete: '删除',
    write_file: '写入文件',
    remove_file: '删除文件',
  } as Record<string, string>)[value] || value;
}
function genericParamLabel(key: string): string {
  return ({
    action: '操作',
    char_limit: '字符上限',
    file_glob: '文件',
    file_path: '文件',
    key: '按键',
    limit: '数量',
    max_rows: '行数',
    name: '名称',
    offset: '起始位置',
    path: '路径',
    query: '查询',
    ref: '元素',
    target: '类型',
    timeout: '超时',
    url: '网址',
    workdir: '目录',
  } as Record<string, string>)[key] || key;
}
function patchedFile(args: Record<string, unknown>): string {
  const path = callValue(args.path);
  if (path) return path;
  if (typeof args.patch !== 'string') return '';
  return args.patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/mu)?.[1]?.trim() || '';
}
function toolCallSummary(call: MessageRow, results: MessageRow[]): ToolCallSummary {
  const name = toolName(call, results);
  const raw = getToolMeta(call).args || '';
  const cached = toolCallSummaryCache.get(call);
  if (cached?.name === name && cached.raw === raw) return cached.value;

  const args = parseToolArgs(call);
  let primary = '';
  let detail = '';
  let params: Array<{ name: string; value: string }> = [];
  switch (name) {
    case 'read_file':
      primary = callValue(args.path) || '（未提供路径）';
      detail = callDetail([`第 ${callValue(args.offset ?? 1)} 行起`, `最多 ${callValue(args.limit ?? 500)} 行`]);
      break;
    case 'skill_view':
      primary = callValue(args.name);
      break;
    case 'terminal':
      primary = callValue(args.command);
      detail = callDetail([labeledCallValue('目录', args.workdir), labeledCallValue('超时', args.timeout, ' 秒')]);
      break;
    case 'search_files':
      params = Object.entries(args)
        .map(([name, value]) => ({ name, value: callValue(value) }));
      break;
    case 'web_search':
      primary = callValue(args.query);
      detail = `最多 ${callValue(args.limit ?? 5)} 条`;
      break;
    case 'web_extract': {
      const urls = Array.isArray(args.urls) ? args.urls : [];
      primary = callValue(urls[0]);
      detail = callDetail([
        urls.length > 1 ? `共 ${urls.length} 个网址` : '',
        args.char_limit != null ? `最多 ${callValue(args.char_limit)} 字符` : '',
      ]);
      break;
    }
    case 'patch':
      primary = patchedFile(args);
      detail = args.mode === 'replace' ? '替换内容' : args.mode === 'patch' ? '应用补丁' : labeledCallValue('方式', args.mode);
      break;
    case 'skill_manage':
      primary = callValue(args.name);
      detail = callDetail([labeledCallValue('操作', skillActionLabel(args.action)), labeledCallValue('文件', args.file_path)]);
      break;
    case 'browser_navigate':
      primary = callValue(args.url);
      break;
    case 'mcp__dameng_smp__dm_describe_table':
      primary = labeledCallValue('数据表', args.table_name);
      break;
    case 'mcp__dameng_smp__dm_query':
      primary = callValue(args.sql);
      detail = args.max_rows != null ? `最多 ${callValue(args.max_rows)} 行` : '';
      break;
    case 'mcp__dameng_smp__dm_sample_data':
      primary = labeledCallValue('数据表', args.table_name);
      detail = args.limit != null ? `最多 ${callValue(args.limit)} 行` : '';
      break;
    case 'mcp__dameng_smp__dm_list_tables':
      detail = args.include_views === true ? '包含视图' : args.include_views === false ? '不包含视图' : '';
      break;
    default: {
      const scalarEntries = Object.entries(args).filter(([, value]) => value == null || typeof value !== 'object');
      const primaryEntry = scalarEntries.find(([key]) => ['command', 'name', 'path', 'pattern', 'query', 'ref', 'table_name', 'url'].includes(key));
      if (primaryEntry) primary = callValue(primaryEntry[1]);
      detail = callDetail(scalarEntries
        .filter(([key]) => key !== primaryEntry?.[0])
        .slice(0, 4)
        .map(([key, value]) => labeledCallValue(genericParamLabel(key), value)));
    }
  }
  const value = {
    name,
    primary,
    detail,
    params,
  };
  toolCallSummaryCache.set(call, { name, raw, value });
  return value;
}

type DisplayItem =
  | { type: 'message'; key: string; message: MessageRow }
  | { type: 'tool-group'; key: string; id: string; call: MessageRow; results: MessageRow[]; ts: number };

const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = [];
  const messages = chatMessages.value;
  const resultIndexesById = new Map<string, number[]>();
  const resultIndexesByName = new Map<string, number[]>();
  const consumedResults = new Set<number>();
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].role !== 'tool') continue;
    const identity = getToolResultIdentity(messages[index]);
    if (identity.id) {
      const indexes = resultIndexesById.get(identity.id) || [];
      indexes.push(index);
      resultIndexesById.set(identity.id, indexes);
    }
    if (identity.name && !identity.id) {
      const indexes = resultIndexesByName.get(identity.name) || [];
      indexes.push(index);
      resultIndexesByName.set(identity.name, indexes);
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'tool' && consumedResults.has(i)) continue;
    if (isToolCall(message, messages[i + 1])) {
      const identity = getToolCallIdentity(message);
      let resultIndexes: number[] = [];
      if (identity.id) {
        resultIndexes = (resultIndexesById.get(identity.id) || [])
          .filter((index) => index > i && !consumedResults.has(index));
      }
      if (!resultIndexes.length && identity.name) {
        const matchingIndex = (resultIndexesByName.get(identity.name) || [])
          .find((index) => index > i && !consumedResults.has(index));
        if (matchingIndex != null) resultIndexes = [matchingIndex];
      }
      if (!resultIndexes.length) {
        for (let index = i + 1; index < messages.length; index++) {
          const candidate = messages[index];
          if (candidate.role === 'tool') {
            if (consumedResults.has(index)) continue;
            if (getToolResultIdentity(candidate).id) continue;
            resultIndexes = [index];
            break;
          }
          if (!isToolCall(candidate, messages[index + 1])) break;
        }
      }
      resultIndexes.forEach((index) => consumedResults.add(index));
      const results = resultIndexes.map((index) => messages[index]);
      const id = `${message.id}-${results.map((r) => r.id).join('-')}`;
      items.push({
        type: 'tool-group',
        key: `tg-${id}`,
        id,
        call: message,
        results,
        ts: message.ts,
      });
    } else {
      items.push({ type: 'message', key: `m-${message.id}`, message });
    }
  }
  return items;
});

function itemExpandKey(item: DisplayItem) {
  if (item.type === 'tool-group') return `tool-group-${item.id}`;
  if (isSystemRole(item.message.role)) return `system-${item.message.id}`;
  if (item.message.role === 'assistant' && getReasoning(item.message)) {
    return `thinking-${item.message.id}`;
  }
  return `tool-${item.message.id}`;
}

function itemSizeDependencies(item: DisplayItem) {
  const dependencies = [isExpanded(itemExpandKey(item))];
  if (item.type === 'tool-group' && getReasoning(item.call)) {
    dependencies.push(isExpanded(`thinking-${item.call.id}`));
  }
  return dependencies;
}

function prettyJson(text: string | null | undefined): string {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

const title = computed(() => {
  if (!props.conversation) return '';
  if (props.conversation.model) return props.conversation.model;
  try { return new URL(props.conversation.url).pathname; } catch { return props.conversation.url; }
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
        <span v-if="conversation.input_tokens != null">in {{ conversation.input_tokens }}</span>
        <span v-if="conversation.output_tokens != null">out {{ conversation.output_tokens }}</span>
        <span>{{ conversation.message_count }} 条</span>
        <span v-if="rawOpenError" class="raw-open-error" :title="rawOpenError">打开失败</span>
        <a-button size="small" :loading="rawLoading" @click="loadRaw" :disabled="!conversation.raw_request_id">原始数据</a-button>
      </div>
    </div>

    <div class="chat-body" id="chat-body">
      <div v-if="!conversation" class="chat-empty">
        <div style="text-align: center">
          <div style="font-size: 48px; opacity: 0.3">💬</div>
          <div style="margin-top: 12px">从左侧选择一个会话查看对话</div>
        </div>
      </div>
      <template v-else>
        <div v-if="messages.length === 0" class="chat-empty">（该会话没有解析出消息）</div>
        <DynamicScroller
          ref="messageScroller"
          v-else-if="displayItems.length"
          class="message-scroller"
          :items="displayItems"
          :min-item-size="64"
          key-field="key"
        >
          <template #default="{ item, index, active }">
            <DynamicScrollerItem :item="item" :active="active" :size-dependencies="itemSizeDependencies(item)" :data-index="index">
              <div
                :class="item.type === 'message' ? ['msg-row', item.message.role] : ['msg-row', 'tool-group']"
              >
          <template v-if="item.type === 'message'">
            <div v-if="isSystemRole(item.message.role)" class="msg-system">
              <div class="collapse-head">
                <span class="system-title">{{ item.message.role === 'developer' ? 'Developer' : '系统提示词' }}</span>
                <span class="collapse-summary" :class="{ hidden: isExpanded(`system-${item.message.id}`) }">{{ summaryText(item.message.content) }}</span>
                <button class="collapse-action" type="button" @click="toggleExpanded(`system-${item.message.id}`, item.key, $event)">{{ isExpanded(`system-${item.message.id}`) ? '收起' : '展开' }}</button>
              </div>
              <div v-if="isExpanded(`system-${item.message.id}`)" class="system-content normal-system-content">{{ item.message.content }}</div>
            </div>
            <div v-else-if="item.message.role === 'user'" class="msg-user">
              <div class="bubble user">
                <template v-for="(p, i) in renderText(item.message.content)" :key="i">
                  <pre v-if="p.type === 'code'" class="code-block"><code>{{ p.content }}</code></pre>
                  <span v-else>{{ p.content }}</span>
                </template>
              </div>
            </div>
            <div v-else-if="item.message.role === 'tool'" class="msg-tool">
              <div class="tool-card">
                <div class="collapse-head tool-collapse-head">
                  <span class="tool-card-title">返回结果：{{ toolResultSource(item.message) }}</span>
                  <span class="collapse-summary">{{ summaryText(item.message.content) }}</span>
                  <button class="collapse-action" type="button" @click="toggleExpanded(`tool-${item.message.id}`, item.key, $event)">{{ isExpanded(`tool-${item.message.id}`) ? '收起' : '展开' }}</button>
                </div>
                <ToolResultView
                  v-if="isExpanded(`tool-${item.message.id}`)"
                  :message="item.message"
                  :tool-name="toolResultSource(item.message)"
                  :show-title="false"
                />
              </div>
            </div>
            <div v-else-if="item.message.role === 'assistant'" class="msg-assistant">
              <div v-if="getReasoning(item.message)" class="thinking-card">
                <div class="collapse-head">
                  <span class="thinking-title">思考过程</span>
                  <button class="collapse-action" type="button" @click="toggleExpanded(`thinking-${item.message.id}`, item.key, $event)">{{ isExpanded(`thinking-${item.message.id}`) ? '收起' : '展开' }}</button>
                </div>
                <div
                  v-if="isExpanded(`thinking-${item.message.id}`)"
                  class="thinking-content markdown-body"
                  v-html="renderMarkdown(getReasoning(item.message))"
                ></div>
              </div>
              <div v-if="item.message.content.trim()" class="bubble assistant markdown-body" v-html="renderMarkdown(item.message.content)"></div>
            </div>
            <div v-if="!isSystemRole(item.message.role)" class="msg-time">{{ fmtTime(item.message.ts) }}</div>
          </template>

          <template v-else>
            <div
              v-if="item.call.content.trim() && !item.call.content.startsWith('[tool_use]')"
              class="msg-assistant"
            >
              <div class="markdown-body" v-html="renderMarkdown(item.call.content)"></div>
            </div>
            <div v-if="getReasoning(item.call)" class="msg-assistant">
              <div class="thinking-card">
                <div class="collapse-head">
                  <span class="thinking-title">思考过程</span>
                  <button class="collapse-action" type="button" @click="toggleExpanded(`thinking-${item.call.id}`, item.key, $event)">{{ isExpanded(`thinking-${item.call.id}`) ? '收起' : '展开' }}</button>
                </div>
                <div
                  v-if="isExpanded(`thinking-${item.call.id}`)"
                  class="thinking-content markdown-body"
                  v-html="renderMarkdown(getReasoning(item.call))"
                ></div>
              </div>
            </div>
            <div class="msg-tool combined">
              <div class="tool-card">
                <div class="collapse-head tool-collapse-head">
                  <span class="tool-call-summary-lines">
                    <span class="tool-call-main-row">
                      <a-tag class="tool-call-type" color="blue">{{ toolCallSummary(item.call, item.results).name }}</a-tag>
                      <span v-if="toolCallSummary(item.call, item.results).params.length" class="tool-call-params">
                        <span v-for="param in toolCallSummary(item.call, item.results).params" :key="param.name" class="tool-call-param-line" :title="`${param.name}：${param.value}`">
                          <span class="tool-call-param-name">{{ param.name }}：</span><span class="tool-call-param-value">{{ param.value }}</span>
                        </span>
                      </span>
                      <span v-else-if="toolCallSummary(item.call, item.results).primary" class="tool-call-primary" :title="toolCallSummary(item.call, item.results).primary">{{ toolCallSummary(item.call, item.results).primary }}</span>
                    </span>
                    <span v-if="toolCallSummary(item.call, item.results).detail" class="tool-call-detail" :title="toolCallSummary(item.call, item.results).detail">{{ toolCallSummary(item.call, item.results).detail }}</span>
                  </span>
                  <button class="collapse-action" type="button" @click="toggleExpanded(`tool-group-${item.id}`, item.key, $event)">{{ isExpanded(`tool-group-${item.id}`) ? '收起' : '展开' }}</button>
                </div>
                <template v-if="isExpanded(`tool-group-${item.id}`)">
                  <div v-if="item.results.length" class="tool-results">
                    <div v-for="result in item.results" :key="result.id" class="tool-result">
                      <ToolResultView
                        :message="result"
                        :tool-name="toolName(item.call, item.results)"
                        :args="getToolMeta(item.call).args"
                      />
                    </div>
                  </div>
                </template>
              </div>
            </div>
            <div class="msg-time">{{ fmtTime(item.ts) }}</div>
          </template>
              </div>
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>
      </template>
    </div>

  </div>
</template>