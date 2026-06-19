import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerConversationIpc } from '../electron/ipc/conversation.ipc';
import { Store } from '../electron/store';

function seedStore(store: Store) {
  const firstAddress = store.addresses.add('https://first.example.com');
  const secondAddress = store.addresses.add('https://second.example.com');
  const firstRawId = insertRaw(store, firstAddress.id, '/first');
  const secondRawId = insertRaw(store, firstAddress.id, '/second');
  const otherAddressRawId = insertRaw(store, secondAddress.id, '/other');
  const orphanRawId = insertRaw(store, firstAddress.id, '/orphan');
  const firstConversationId = insertConversation(store, firstAddress.id, firstRawId, '/first');
  const secondConversationId = insertConversation(store, firstAddress.id, secondRawId, '/second');
  const otherAddressConversationId = insertConversation(
    store,
    secondAddress.id,
    otherAddressRawId,
    '/other',
  );
  insertMessage(store, firstConversationId, 'first');
  insertMessage(store, secondConversationId, 'second');
  insertMessage(store, otherAddressConversationId, 'other');
  return {
    firstAddress,
    secondAddress,
    firstRawId,
    secondRawId,
    otherAddressRawId,
    orphanRawId,
    firstConversationId,
    secondConversationId,
    otherAddressConversationId,
  };
}

function insertRaw(store: Store, addressId: number, pathname: string): number {
  return store.raws.insert({
    address_id: addressId,
    method: 'POST',
    url: `https://api.example.com${pathname}`,
    req_headers: '{}',
    req_body: '{}',
    resp_status: 200,
    resp_headers: '{}',
    resp_body: '{}',
    started_at: 1,
    ended_at: 2,
    protocol: 'openai_chat',
    client_addr: '127.0.0.1',
  });
}

function insertConversation(
  store: Store,
  addressId: number,
  rawId: number,
  pathname: string,
): number {
  return store.conversations.insert({
    address_id: addressId,
    url: `https://api.example.com${pathname}`,
    method: 'POST',
    started_at: rawId,
    ended_at: rawId + 1,
    status: 200,
    model: 'test-model',
    raw_request_id: rawId,
    message_count: 1,
    input_tokens: null,
    output_tokens: null,
    preview: pathname,
  });
}

function insertMessage(store: Store, conversationId: number, content: string): number {
  return store.messages.insert({
    conversation_id: conversationId,
    role: 'user',
    content,
    ts: 1,
    seq: 0,
  });
}

describe('会话数据删除', () => {
  it('删除一条会话时级联删除消息和专属 raw，但保留其他数据', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-delete-'));
    const store = new Store(path.join(dir, 'store.json'));
    try {
      const seeded = seedStore(store);

      expect(store.conversations.delete(seeded.firstConversationId)).toEqual({
        deleted: true,
        rawIds: [seeded.firstRawId],
      });

      const data = store.json.getData();
      expect(data.conversations.map((row) => row.id)).toEqual([
        seeded.secondConversationId,
        seeded.otherAddressConversationId,
      ]);
      expect(data.messages.map((row) => row.conversation_id)).toEqual([
        seeded.secondConversationId,
        seeded.otherAddressConversationId,
      ]);
      expect(data.raw_requests.map((row) => row.id)).toEqual([
        seeded.secondRawId,
        seeded.otherAddressRawId,
        seeded.orphanRawId,
      ]);
      expect(data.addresses).toHaveLength(2);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('清空当前地址的全部会话、消息和 raw，但保留地址及其他地址的数据', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-clear-'));
    const store = new Store(path.join(dir, 'store.json'));
    try {
      const seeded = seedStore(store);

      expect(store.conversations.clearByAddress(seeded.firstAddress.id)).toEqual({
        deletedCount: 2,
        rawIds: [seeded.firstRawId, seeded.secondRawId, seeded.orphanRawId],
      });

      const data = store.json.getData();
      expect(data.conversations.map((row) => row.id)).toEqual([
        seeded.otherAddressConversationId,
      ]);
      expect(data.messages.map((row) => row.conversation_id)).toEqual([
        seeded.otherAddressConversationId,
      ]);
      expect(data.raw_requests.map((row) => row.id)).toEqual([seeded.otherAddressRawId]);
      expect(data.addresses.map((row) => row.id)).toEqual([
        seeded.firstAddress.id,
        seeded.secondAddress.id,
      ]);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('会话删除 IPC', () => {
  it('仅由可信主窗口删除会话并关闭关联原始数据窗口', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-delete-ipc-'));
    const store = new Store(path.join(dir, 'store.json'));
    try {
      const seeded = seedStore(store);
      const handlers = new Map<string, (...args: any[]) => unknown>();
      const mainFrame = { url: 'http://localhost:5173/' };
      const mainWebContents = { mainFrame, getURL: () => mainFrame.url };
      const close = vi.fn();
      registerConversationIpc({
        ipcMain: {
          handle: (channel: string, handler: (...args: any[]) => unknown) => {
            handlers.set(channel, handler);
          },
        },
        store,
        getMainWindow: () => ({ webContents: mainWebContents, isDestroyed: () => false }),
        rawWindows: {
          open: vi.fn(),
          getRawId: vi.fn(() => null),
          close,
          closeAll: vi.fn(),
        },
      } as any);

      const handler = handlers.get('conversations:delete');
      expect(handler).toBeTypeOf('function');
      await handler?.(
        { sender: mainWebContents, senderFrame: mainFrame },
        seeded.firstConversationId,
      );

      expect(store.conversations.getById(seeded.firstConversationId)).toBeUndefined();
      expect(close).toHaveBeenCalledWith(seeded.firstRawId);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('由可信主窗口清空当前地址并关闭全部关联原始数据窗口', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packet-sniffer-clear-ipc-'));
    const store = new Store(path.join(dir, 'store.json'));
    try {
      const seeded = seedStore(store);
      const handlers = new Map<string, (...args: any[]) => unknown>();
      const mainFrame = { url: 'http://localhost:5173/' };
      const mainWebContents = { mainFrame, getURL: () => mainFrame.url };
      const close = vi.fn();
      registerConversationIpc({
        ipcMain: {
          handle: (channel: string, handler: (...args: any[]) => unknown) => {
            handlers.set(channel, handler);
          },
        },
        store,
        getMainWindow: () => ({ webContents: mainWebContents, isDestroyed: () => false }),
        rawWindows: {
          open: vi.fn(),
          getRawId: vi.fn(() => null),
          close,
          closeAll: vi.fn(),
        },
      } as any);

      const handler = handlers.get('conversations:clear');
      expect(handler).toBeTypeOf('function');
      await handler?.(
        { sender: mainWebContents, senderFrame: mainFrame },
        seeded.firstAddress.id,
      );

      expect(store.conversations.listByAddress(seeded.firstAddress.id)).toEqual([]);
      expect(close.mock.calls.map(([rawId]) => rawId)).toEqual([
        seeded.firstRawId,
        seeded.secondRawId,
        seeded.orphanRawId,
      ]);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('拒绝非主窗口、子 frame 和非法 ID 发起破坏性操作', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const mainFrame = { url: 'http://localhost:5173/' };
    const mainWebContents = { mainFrame, getURL: () => mainFrame.url };
    const deleteConversation = vi.fn();
    const clearByAddress = vi.fn();
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { delete: deleteConversation, clearByAddress },
      },
      getMainWindow: () => ({ webContents: mainWebContents, isDestroyed: () => false }),
      rawWindows: {
        open: vi.fn(),
        getRawId: vi.fn(() => null),
        close: vi.fn(),
        closeAll: vi.fn(),
      },
    } as any);

    const deleteHandler = handlers.get('conversations:delete')!;
    const clearHandler = handlers.get('conversations:clear')!;
    const remoteFrame = { url: 'https://attacker.example/' };
    const remoteSender = { mainFrame: remoteFrame, getURL: () => remoteFrame.url };
    expect(() =>
      deleteHandler({ sender: remoteSender, senderFrame: remoteFrame }, 1),
    ).toThrow('无权删除该会话');
    expect(() =>
      clearHandler({ sender: mainWebContents, senderFrame: remoteFrame }, 1),
    ).toThrow('无权清空该地址的会话');
    expect(() =>
      deleteHandler({ sender: mainWebContents, senderFrame: mainFrame }, 0),
    ).toThrow('无权删除该会话');
    expect(() =>
      clearHandler({ sender: mainWebContents, senderFrame: mainFrame }, Number.NaN),
    ).toThrow('无权清空该地址的会话');
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(clearByAddress).not.toHaveBeenCalled();
  });
});
