import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/components/SessionList.vue'),
  'utf8',
);
const styles = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../src/App.vue'), 'utf8');
const preload = fs.readFileSync(path.resolve(__dirname, '../electron/preload.ts'), 'utf8');
const rendererApi = fs.readFileSync(path.resolve(__dirname, '../src/api/index.ts'), 'utf8');

describe('SessionList', () => {
  it('使用固定高度虚拟滚动而不是全量渲染会话 DOM', () => {
    expect(source).toContain("import { RecycleScroller } from 'vue-virtual-scroller';");
    expect(source).toContain('<RecycleScroller');
    expect(source).toContain(':items="props.conversations"');
    expect(source).toContain('const SESSION_ITEM_SIZE = 74;');
    expect(source).toContain(':item-size="SESSION_ITEM_SIZE"');
    expect(source).toContain('key-field="id"');
    expect(source).not.toMatch(/v-for="[^"]*\bconversations\b[^"]*"/u);
    expect(styles).toMatch(/\.session-item\.ant-card\s*\{[^}]*height:\s*66px;/u);
  });

  it('为单条删除和清空当前地址提供一次确认的固定 API', () => {
    expect(source).toContain('delete: [id: number]');
    expect(source).toContain('clear: []');
    expect(source).toContain("@confirm=\"emit('delete', c.id)\"");
    expect(source).not.toContain('pendingDeleteId');
    expect(source).not.toContain('title="删除会话"');
    expect(source).toContain("@confirm=\"emit('clear')\"");
    expect(source).toContain('确认删除该会话及其原始数据？');
    expect(source).toContain('确认清空当前地址的全部会话？');
    expect(source).toContain('@click.stop');
    expect(preload).toContain("ipcRenderer.invoke('conversations:delete', id)");
    expect(preload).toContain("ipcRenderer.invoke('conversations:clear', addressId)");
    expect(rendererApi).toContain('window.sniffer.conversations.remove(id)');
    expect(rendererApi).toContain('window.sniffer.conversations.clear(addressId)');
    expect(app).toContain('@delete="deleteConversation"');
    expect(app).toContain('@clear="clearConversations"');
    expect(app).toContain('if (selectedConversationId.value !== id) return;');
  });
});
