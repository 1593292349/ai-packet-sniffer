import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRawWindowManager } from '../electron/rawWindow';
import { registerConversationIpc } from '../electron/ipc/conversation.ipc';
import { formatRawText, isStructuredRawText, parseRawViewId } from '../src/rawView';

class FakeWindow {
  private webContentsListeners = new Map<string, (event: { preventDefault(): void }) => void>();
  readonly webContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => {
      this.webContentsListeners.set(event, listener);
    }),
  };
  readonly loadURL = vi.fn(async () => undefined);
  readonly loadFile = vi.fn(async () => undefined);
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly close = vi.fn();
  private listeners = new Map<string, () => void>();

  once(event: string, listener: () => void) {
    this.listeners.set(event, listener);
    return this;
  }

  on(event: string, listener: () => void) {
    this.listeners.set(event, listener);
    return this;
  }

  emit(event: string) {
    this.listeners.get(event)?.();
  }

  emitWebContents(event: string) {
    const navigationEvent = { preventDefault: vi.fn() };
    this.webContentsListeners.get(event)?.(navigationEvent);
    return navigationEvent;
  }

  isDestroyed() {
    return false;
  }
}

describe('RawWindowManager', () => {
  it('在开发环境创建安全的非模态独立窗口并加载指定原始记录', async () => {
    const created: Array<{ options: BrowserWindowConstructorOptions; window: FakeWindow }> = [];
    const manager = createRawWindowManager({
      createWindow: (options) => {
        const window = new FakeWindow();
        created.push({ options, window });
        return window;
      },
      preloadPath: 'D:/app/preload.js',
      rendererPath: 'D:/app/index.html',
      devServerUrl: 'http://localhost:5173',
    });

    await manager.open(40);

    expect(created).toHaveLength(1);
    expect(created[0].options).toMatchObject({
      width: 900,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      modal: false,
      show: false,
      title: '原始请求 / 响应 #40',
      webPreferences: {
        preload: 'D:/app/preload.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    expect(created[0].options).not.toHaveProperty('parent');
    expect(created[0].window.loadURL).toHaveBeenCalledWith(
      'http://localhost:5173/?view=raw&rawId=40',
    );
    expect(created[0].window.webContents.setWindowOpenHandler).toHaveBeenCalled();
    expect(manager.getRawId(created[0].window.webContents as any)).toBe(40);
    expect(manager.getRawId({} as any)).toBeNull();
    expect(created[0].window.webContents.on).toHaveBeenCalledWith(
      'will-navigate',
      expect.any(Function),
    );
    expect(created[0].window.webContents.on).toHaveBeenCalledWith(
      'will-redirect',
      expect.any(Function),
    );
    expect(created[0].window.emitWebContents('will-navigate').preventDefault).toHaveBeenCalled();
    expect(created[0].window.emitWebContents('will-redirect').preventDefault).toHaveBeenCalled();

    created[0].window.emit('ready-to-show');
    expect(created[0].window.show).toHaveBeenCalledOnce();
  });

  it('同一条原始记录重复打开时复用并聚焦已有窗口', async () => {
    const windows: FakeWindow[] = [];
    const manager = createRawWindowManager({
      createWindow: () => {
        const window = new FakeWindow();
        windows.push(window);
        return window;
      },
      preloadPath: 'D:/app/preload.js',
      rendererPath: 'D:/app/index.html',
      devServerUrl: 'http://localhost:5173',
    });

    await manager.open(40);
    await manager.open(40);

    expect(windows).toHaveLength(1);
    expect(windows[0].show).toHaveBeenCalledOnce();
    expect(windows[0].focus).toHaveBeenCalledOnce();
  });

  it('删除记录时关闭并解除对应原始数据窗口的读取授权', async () => {
    const window = new FakeWindow();
    const manager = createRawWindowManager({
      createWindow: () => window,
      preloadPath: 'D:/app/preload.js',
      rendererPath: 'D:/app/index.html',
      devServerUrl: 'http://localhost:5173',
    });

    await manager.open(40);
    manager.close(40);

    expect(window.close).toHaveBeenCalledOnce();
    expect(manager.getRawId(window.webContents as any)).toBeNull();
  });

  it('生产环境从打包后的渲染入口加载原始数据视图', async () => {
    const window = new FakeWindow();
    const manager = createRawWindowManager({
      createWindow: () => window,
      preloadPath: 'D:/app/preload.js',
      rendererPath: 'D:/app/index.html',
    });

    await manager.open(40);

    expect(window.loadFile).toHaveBeenCalledWith('D:/app/index.html', {
      query: { view: 'raw', rawId: '40' },
    });
    expect(window.loadURL).not.toHaveBeenCalled();
  });

  it('加载失败时关闭并移除窗口以便下次重试', async () => {
    const windows: FakeWindow[] = [];
    const manager = createRawWindowManager({
      createWindow: () => {
        const window = new FakeWindow();
        if (windows.length === 0) {
          window.loadURL.mockRejectedValueOnce(new Error('load failed'));
        }
        windows.push(window);
        return window;
      },
      preloadPath: 'D:/app/preload.js',
      rendererPath: 'D:/app/index.html',
      devServerUrl: 'http://localhost:5173',
    });

    await expect(manager.open(40)).rejects.toThrow('load failed');
    await manager.open(40);
    windows[0].emit('closed');
    await manager.open(40);

    expect(windows).toHaveLength(2);
    expect(windows[0].close).toHaveBeenCalledOnce();
    expect(windows[1].focus).toHaveBeenCalledOnce();
  });

  it('并发打开同一记录时共享加载结果和失败状态', async () => {
    const window = new FakeWindow();
    let rejectLoad!: (reason: Error) => void;
    window.loadURL.mockImplementation(
      () => new Promise<void>((_resolve, reject) => { rejectLoad = reject; }),
    );
    const manager = createRawWindowManager({
      createWindow: () => window as any,
      preloadPath: 'D:/dist/electron/rawPreload.js',
      rendererPath: 'D:/dist/renderer/index.html',
      devServerUrl: 'http://localhost:5173',
    });

    const first = manager.open(40);
    const second = manager.open(40);
    rejectLoad(new Error('load failed'));

    await expect(first).rejects.toThrow('load failed');
    await expect(second).rejects.toThrow('load failed');
    expect(window.show).not.toHaveBeenCalled();
  });
});

describe('raw:open IPC', () => {
  it('只在记录存在时让主窗口打开对应原始数据窗口', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const mainFrame = { url: 'http://localhost:5173/' };
    const mainWebContents = { mainFrame, getURL: () => mainFrame.url };
    const open = vi.fn(async () => undefined);
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { listByAddress: vi.fn() },
        messages: { listByConversation: vi.fn() },
        raws: { getById: vi.fn(() => ({ id: 40 })) },
      },
      getMainWindow: () => ({ webContents: mainWebContents, isDestroyed: () => false }),
      rawWindows: { open, getRawId: vi.fn(), closeAll: vi.fn() },
    } as any);

    await handlers.get('raw:open')?.({ sender: mainWebContents, senderFrame: mainFrame }, 40);

    expect(open).toHaveBeenCalledWith(40);
  });

  it('拒绝非应用窗口读取原始数据', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { listByAddress: vi.fn() },
        messages: { listByConversation: vi.fn() },
        raws: { getById: vi.fn(() => ({ id: 40 })) },
      },
      getMainWindow: () => ({ webContents: {}, isDestroyed: () => false }),
      rawWindows: { open: vi.fn(), getRawId: vi.fn(() => null), closeAll: vi.fn() },
    } as any);

    await expect(
      handlers.get('raw:get')?.({ sender: {} }),
    ).rejects.toThrow('无权读取该原始数据');
  });

  it('原始数据窗口只能读取创建窗口时绑定的记录', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const mainFrame = { url: 'file:///D:/app/renderer/index.html?view=raw&rawId=41' };
    const sender = { mainFrame, getURL: () => mainFrame.url };
    const getRawId = vi.fn(() => 40);
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { listByAddress: vi.fn() },
        messages: { listByConversation: vi.fn() },
        raws: { getById: vi.fn(() => ({ id: 41 })) },
      },
      getMainWindow: () => ({ webContents: {}, isDestroyed: () => false }),
      rawWindows: {
        open: vi.fn(),
        getRawId,
        closeAll: vi.fn(),
      },
    } as any);

    await expect(
      handlers.get('raw:get')?.({ sender, senderFrame: mainFrame }),
    ).rejects.toThrow('无权读取该原始数据');
    expect(getRawId).toHaveBeenCalledWith(sender);
  });

  it('原始数据窗口无须传入 ID 即可读取自身绑定记录', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const mainFrame = { url: 'file:///D:/app/renderer/index.html?view=raw&rawId=40' };
    const sender = { mainFrame, getURL: () => mainFrame.url };
    const getById = vi.fn(() => ({ id: 40 }));
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { listByAddress: vi.fn() },
        messages: { listByConversation: vi.fn() },
        raws: { getById },
      },
      getMainWindow: () => ({ webContents: {}, isDestroyed: () => false }),
      rawWindows: {
        open: vi.fn(),
        getRawId: vi.fn(() => 40),
        closeAll: vi.fn(),
      },
    } as any);

    await expect(
      handlers.get('raw:get')?.({ sender, senderFrame: mainFrame }),
    ).resolves.toEqual({ id: 40 });
    expect(getById).toHaveBeenCalledWith(40);
  });

  it('拒绝子 frame 调用原始数据 IPC', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const mainFrame = {};
    const sender = { mainFrame };
    const senderFrame = {};
    const open = vi.fn();
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { listByAddress: vi.fn() },
        messages: { listByConversation: vi.fn() },
        raws: { getById: vi.fn(() => ({ id: 40 })) },
      },
      getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
      rawWindows: { open, getRawId: vi.fn(() => 40), closeAll: vi.fn() },
    } as any);

    await expect(
      handlers.get('raw:get')?.({ sender, senderFrame }),
    ).rejects.toThrow('无权读取该原始数据');
    await expect(
      handlers.get('raw:open')?.({ sender, senderFrame }, 40),
    ).rejects.toThrow('无权打开该原始数据窗口');
    expect(open).not.toHaveBeenCalled();
  });

  it('拒绝非应用 origin 调用原始数据 IPC', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const mainFrame = { url: 'https://example.com/' };
    const sender = { mainFrame, getURL: () => mainFrame.url };
    const open = vi.fn();
    registerConversationIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => unknown) => {
          handlers.set(channel, handler);
        },
      },
      store: {
        conversations: { listByAddress: vi.fn() },
        messages: { listByConversation: vi.fn() },
        raws: { getById: vi.fn(() => ({ id: 40 })) },
      },
      getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
      rawWindows: { open, getRawId: vi.fn(() => 40), closeAll: vi.fn() },
    } as any);

    await expect(
      handlers.get('raw:get')?.({ sender, senderFrame: mainFrame }),
    ).rejects.toThrow('无权读取该原始数据');
    await expect(
      handlers.get('raw:open')?.({ sender, senderFrame: mainFrame }, 40),
    ).rejects.toThrow('无权打开该原始数据窗口');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('原始数据视图路由', () => {
  it('只接受原始数据窗口使用的正整数记录 ID', () => {
    expect(parseRawViewId('?view=raw&rawId=40')).toBe(40);
    expect(parseRawViewId('?view=raw&rawId=0')).toBeNull();
    expect(parseRawViewId('?view=raw&rawId=abc')).toBeNull();
    expect(parseRawViewId('?rawId=40')).toBeNull();
  });

  it('只格式化小型 JSON，超大内容保持原文以避免内存放大', () => {
    expect(formatRawText('{"ok":true}')).toBe('{\n  "ok": true\n}');
    const large = JSON.stringify({ content: 'x'.repeat(1_000_000) });
    expect(formatRawText(large)).toBe(large);
    expect(isStructuredRawText('{"ok":true}')).toBe(true);
    expect(isStructuredRawText(large)).toBe(false);
  });
});

describe('原始数据按钮', () => {
  it('通过固定 preload API 打开独立视图而不再渲染抽屉', () => {
    const root = path.resolve(__dirname, '..');
    const chatPanel = fs.readFileSync(path.join(root, 'src/components/ChatPanel.vue'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
    const rawPreload = fs.readFileSync(path.join(root, 'electron/rawPreload.ts'), 'utf8');
    const electronMain = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const rawDataView = fs.readFileSync(
      path.join(root, 'src/components/RawDataView.vue'),
      'utf8',
    );

    expect(chatPanel).toContain('await api.raw.open(rawId);');
    expect(chatPanel).not.toContain('<a-drawer');
    expect(chatPanel).toContain('rawOpenError.value =');
    expect(chatPanel).toContain('v-if="rawOpenError"');
    expect(chatPanel).toContain('const generation = ++rawOpenGeneration;');
    expect(chatPanel).toContain('generation !== rawOpenGeneration');
    expect(preload).toContain("ipcRenderer.invoke('raw:open', id)");
    expect(preload).not.toContain("ipcRenderer.invoke('raw:get'");
    expect(rawPreload).toContain("exposeInMainWorld('rawSniffer'");
    expect(rawPreload).toContain("get: (): Promise<RawRequestRow | null> => ipcRenderer.invoke('raw:get')");
    expect(rawPreload).not.toContain('proxy:');
    expect(rawDataView).toContain('window.rawSniffer.get()');
    expect(rawDataView).toContain('ref="reqHeadersWrap"');
    expect(rawDataView).toContain('ref="respBodyWrap"');
    expect(rawDataView).not.toContain('<pre class="raw-view">');
    expect(rawDataView).toContain(
      '...(structured ? [basicSetup, json(), EditorView.lineWrapping] : [])',
    );
    expect(electronMain).toContain("preloadPath: path.join(__dirname, 'rawPreload.js')");
    expect(electronMain).toContain('sandbox: true');
    expect(electronMain).toContain('setWindowOpenHandler');
    expect(electronMain).toContain("webContents.on('will-navigate'");
    expect(electronMain).toContain("webContents.on('will-redirect'");
    expect(indexHtml).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(indexHtml).not.toContain("'unsafe-eval'");
    expect(app).toContain('<RawDataView v-if="rawViewId != null" :raw-id="rawViewId" />');
  });
});
