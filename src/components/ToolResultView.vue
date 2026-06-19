<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import type { MessageRow } from '../types';

const props = withDefaults(defineProps<{
  message: MessageRow;
  toolName?: string;
  args?: string;
  showTitle?: boolean;
}>(), {
  toolName: '',
  args: '',
  showTitle: true,
});

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

const toolLabels: Record<string, string> = {
  terminal: '终端执行',
  patch: '代码补丁',
  read_file: '文件内容',
  search_files: '文件搜索',
  web_search: '网页搜索',
  web_extract: '网页正文',
  browser_navigate: '浏览器页面',
  skill_view: 'Skill 详情',
  skill_manage: 'Skill 操作',
  mcp__dameng_smp__dm_list_tables: '数据库表列表',
  mcp__dameng_smp__dm_describe_table: '数据库表结构',
  mcp__dameng_smp__dm_query: 'SQL 查询结果',
  mcp__dameng_smp__dm_sample_data: '数据库样例数据',
};

function tryParseJson(value: unknown): any | null {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function extractJson(text: string): any | null {
  const direct = tryParseJson(text.trim());
  if (direct !== null) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return tryParseJson(text.slice(start, end + 1));
}

function unwrapDatabaseResult(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  for (const key of ['result', 'content', 'error']) {
    const nested = tryParseJson(value[key]);
    if (nested && typeof nested === 'object') return nested;
  }
  return value;
}

const callArgs = computed<Record<string, any>>(() => {
  const value = tryParseJson(props.args);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
});

const parsed = computed(() => {
  let body = (props.message.content || '').trim();
  if (body.startsWith('[tool_result]')) body = body.slice('[tool_result]'.length).trim();

  let source = props.toolName;
  const xml = body.match(/^<untrusted_tool_result source="([^"]+)">\s*/u);
  if (xml) {
    source = xml[1];
    body = body.slice(xml[0].length).replace(/<\/untrusted_tool_result>\s*$/u, '').trim();
  }

  const legacyTerminal = body.match(/^\[terminal\] ran `[\s\S]*?` -> exit ([^,]+), ([^\n]+)$/u);
  if (legacyTerminal) {
    return {
      source: 'terminal',
      body,
      data: {
        output: legacyTerminal[2],
        exit_code: legacyTerminal[1],
      },
    };
  }

  const bracket = body.match(/^\[([a-zA-Z_][\w-]*)\]\s*([\s\S]*)$/u);
  if (bracket && bracket[1] !== 'tool_result') {
    source ||= bracket[1];
    body = bracket[2].trim();
  }

  const outerData = extractJson(body);
  const data = source.startsWith('mcp__dameng_smp__')
    ? unwrapDatabaseResult(outerData)
    : outerData;
  return { source: source || 'tool', body, data };
});

const source = computed(() => parsed.value.source);
const data = computed<any>(() => parsed.value.data);
const title = computed(() => toolLabels[source.value] || source.value || '工具返回');
const isDatabase = computed(() => source.value.startsWith('mcp__dameng_smp__'));
const selectedWebItem = ref<any | null>(null);
const success = computed<boolean | undefined>(() => {
  if (typeof data.value?.success === 'boolean') return data.value.success;
  if (typeof data.value?.exit_code === 'number') return data.value.exit_code === 0;
  return undefined;
});

const webItems = computed<any[]>(() => data.value?.data?.web || []);
const extractedPages = computed<any[]>(() => Array.isArray(data.value?.results) ? data.value.results : []);
const searchFilesOutput = computed(() => {
  if (typeof data.value?.matches_text === 'string') return data.value.matches_text;
  if (Array.isArray(data.value?.files)) return data.value.files.map(String).join('\n');
  if (typeof data.value?.error === 'string') return data.value.error;
  return '';
});
const tableRows = computed<any[]>(() => {
  if (Array.isArray(data.value?.tables)) return data.value.tables;
  if (Array.isArray(data.value?.columns) && !Array.isArray(data.value?.rows)) return data.value.columns;
  if (Array.isArray(data.value?.rows)) return data.value.rows;
  return [];
});
const tableColumns = computed<string[]>(() => {
  if (Array.isArray(data.value?.tables)) return ['name', 'type', 'comments'];
  if (Array.isArray(data.value?.columns) && !Array.isArray(data.value?.rows)) {
    return ['name', 'type', 'length', 'nullable', 'defaultValue', 'comments', 'isPrimaryKey'];
  }
  if (Array.isArray(data.value?.fields)) return data.value.fields.map(String);
  const first = tableRows.value[0];
  return first && typeof first === 'object' ? Object.keys(first) : [];
});

watch(() => props.message.id, () => {
  selectedWebItem.value = null;
});

function safeExternalUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function showWebContent(entry: any) {
  selectedWebItem.value = entry;
}

function renderMarkdown(text: string) {
  return md.render((text || '').trim());
}

function pretty(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function columnLabel(key: string): string {
  const labels: Record<string, string> = {
    name: '名称',
    type: '类型',
    comments: '说明',
    length: '长度',
    nullable: '可空',
    defaultValue: '默认值',
    isPrimaryKey: '主键',
  };
  return labels[key] || key;
}
</script>

<template>
  <div class="tool-result-view">
    <div v-if="showTitle && !['read_file', 'search_files', 'skill_view', 'terminal', 'web_search'].includes(source)" class="tool-result-heading">
      <span class="tool-card-title">返回结果：{{ title }}</span>
      <span v-if="!['read_file', 'skill_view'].includes(source) && success === true" class="tool-status success">成功</span>
      <span v-else-if="!['read_file', 'skill_view'].includes(source) && success === false" class="tool-status error">失败</span>
    </div>

    <template v-if="source === 'terminal'">
      <pre v-if="data?.output" class="tool-output">{{ data.output }}</pre>
    </template>

    <template v-else-if="source === 'patch'">
      <div v-if="data?.files_modified?.length" class="tool-file-tags">
        <code v-for="file in data.files_modified" :key="file">{{ file }}</code>
      </div>
      <pre v-if="data?.diff" class="tool-output diff-output">{{ data.diff }}</pre>
      <pre v-if="data?.lint" class="tool-output">{{ pretty(data.lint) }}</pre>
      <pre v-if="data?.error || data?._warning" class="tool-output error-output">{{ data.error || data._warning }}</pre>
      <pre v-if="!data" class="tool-output">{{ parsed.body }}</pre>
    </template>

    <template v-else-if="source === 'read_file'">
      <pre v-if="data?.content" class="tool-output file-output">{{ data.content }}</pre>
      <pre v-if="data?.error" class="tool-output error-output">{{ data.error }}</pre>
    </template>

    <template v-else-if="source === 'search_files'">
      <pre class="tool-output file-output">{{ searchFilesOutput }}</pre>
    </template>

    <template v-else-if="source === 'web_search'">
      <div class="tool-search-list">
        <div v-for="entry in webItems" :key="entry.position || entry.url" class="tool-search-item">
          <div class="tool-search-title">{{ entry.title }}</div>
          <a
            v-if="safeExternalUrl(entry.url)"
            class="tool-search-url"
            :href="safeExternalUrl(entry.url)"
            target="_blank"
            rel="noopener noreferrer"
          >{{ entry.url }}</a>
          <span v-else class="tool-search-url">{{ entry.url }}</span>
          <div class="tool-search-action">
            <a-button class="tool-search-view" type="link" size="small" @click="showWebContent(entry)">查看</a-button>
          </div>
        </div>
      </div>
      <a-modal
        :open="selectedWebItem != null"
        :title="selectedWebItem?.title || '网页内容'"
        width="760px"
        :footer="null"
        @cancel="selectedWebItem = null"
      >
        <a
          v-if="safeExternalUrl(selectedWebItem?.url)"
          class="web-search-modal-url"
          :href="safeExternalUrl(selectedWebItem?.url)"
          target="_blank"
          rel="noopener noreferrer"
        >{{ selectedWebItem?.url }}</a>
        <div class="web-search-modal-content">{{ selectedWebItem?.description }}</div>
      </a-modal>
    </template>

    <template v-else-if="source === 'web_extract'">
      <div class="tool-extract-list">
        <section v-for="page in extractedPages" :key="page.url" class="tool-extract-page">
          <div class="tool-page-title">{{ page.title || page.url }}</div>
          <div v-if="page.url" class="tool-search-url">{{ page.url }}</div>
          <div v-if="page.content" class="tool-markdown markdown-body" v-html="renderMarkdown(page.content)"></div>
          <pre v-if="page.error" class="tool-output error-output">{{ pretty(page.error) }}</pre>
        </section>
      </div>
    </template>

    <template v-else-if="source === 'browser_navigate'">
      <div class="tool-page-title">{{ data?.title }}</div>
      <div v-if="data?.url" class="tool-search-url">{{ data.url }}</div>
      <pre v-if="data?.snapshot" class="tool-output file-output">{{ data.snapshot }}</pre>
    </template>

    <template v-else-if="source === 'skill_view'">
      <div v-if="data?.skill_dir" class="tool-kv"><span>技能目录</span><code>{{ data.skill_dir }}</code></div>
      <pre v-if="data?.content" class="tool-output skill-content-text">{{ data.content }}</pre>
      <pre v-if="data?.error" class="tool-output error-output">{{ data.error }}</pre>
    </template>

    <template v-else-if="source === 'skill_manage'">
      <pre v-if="data?.diff" class="tool-output diff-output">{{ data.diff }}</pre>
      <pre v-if="data?.error" class="tool-output error-output">{{ data.error }}</pre>
      <pre v-if="!data?.diff && !data?.error" class="tool-output">{{ pretty(data) || parsed.body }}</pre>
    </template>

    <template v-else-if="isDatabase">
      <div class="tool-result-meta">
        <strong>{{ data?.tableName || callArgs.table_name || title }}</strong>
        <span v-if="data?.totalCount != null">{{ data.totalCount }} 张表</span>
        <span v-if="data?.rowCount != null">{{ data.rowCount }} 行</span>
        <span v-if="data?.totalRowCount != null">共 {{ data.totalRowCount }} 行</span>
        <span v-if="data?.isTruncated">结果已截断</span>
      </div>
      <pre v-if="data?.error" class="tool-output error-output">{{ data.error }}</pre>
      <div v-if="tableRows.length" class="tool-data-table-wrap">
        <table class="tool-data-table">
          <thead>
            <tr><th v-for="column in tableColumns" :key="column">{{ columnLabel(column) }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in tableRows" :key="rowIndex">
              <td v-for="column in tableColumns" :key="column">{{ displayValue(row?.[column]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data?.primaryKeys?.length" class="tool-result-meta">
        <span>主键</span><code>{{ data.primaryKeys.join(', ') }}</code>
      </div>
      <pre v-if="data?.indexes?.length" class="tool-output">{{ pretty(data.indexes) }}</pre>
    </template>

    <pre v-else-if="data" class="tool-output">{{ pretty(data) }}</pre>
    <pre v-else class="tool-output">{{ parsed.body }}</pre>
  </div>
</template>
