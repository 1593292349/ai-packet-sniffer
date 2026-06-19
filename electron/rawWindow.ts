import type { BrowserWindowConstructorOptions, WebContents } from 'electron';

interface RawWindowLike {
  webContents: {
    setWindowOpenHandler(handler: () => { action: 'deny' }): void;
    on(
      event: 'will-navigate' | 'will-redirect',
      listener: (event: { preventDefault(): void }) => void,
    ): void;
  };
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string, options?: { query?: Record<string, string> }): Promise<void>;
  once(event: 'ready-to-show', listener: () => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
}

interface RawWindowManagerOptions {
  createWindow(options: BrowserWindowConstructorOptions): RawWindowLike;
  preloadPath: string;
  rendererPath: string;
  devServerUrl?: string;
}

export interface RawWindowManager {
  open(rawId: number): Promise<void>;
  getRawId(sender: WebContents): number | null;
  close(rawId: number): void;
  closeAll(): void;
}

export function createRawWindowManager(options: RawWindowManagerOptions): RawWindowManager {
  const windows = new Map<number, RawWindowLike>();
  const pendingLoads = new Map<number, Promise<void>>();

  return {
    async open(rawId: number) {
      const existing = windows.get(rawId);
      if (existing && !existing.isDestroyed()) {
        const pendingLoad = pendingLoads.get(rawId);
        if (pendingLoad) await pendingLoad;
        if (existing.isDestroyed() || windows.get(rawId) !== existing) return;
        existing.show();
        existing.focus();
        return;
      }

      const window = options.createWindow({
        width: 900,
        height: 720,
        minWidth: 640,
        minHeight: 480,
        modal: false,
        show: false,
        title: `原始请求 / 响应 #${rawId}`,
        backgroundColor: '#ffffff',
        webPreferences: {
          preload: options.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      windows.set(rawId, window);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const preventNavigation = (event: { preventDefault(): void }) => event.preventDefault();
      window.webContents.on('will-navigate', preventNavigation);
      window.webContents.on('will-redirect', preventNavigation);
      window.once('ready-to-show', () => {
        if (windows.get(rawId) === window && !window.isDestroyed()) window.show();
      });
      window.on('closed', () => {
        if (windows.get(rawId) === window) windows.delete(rawId);
      });

      let loadPromise: Promise<void> | null = null;
      try {
        if (options.devServerUrl) {
          const url = new URL(options.devServerUrl);
          url.searchParams.set('view', 'raw');
          url.searchParams.set('rawId', String(rawId));
          loadPromise = window.loadURL(url.toString());
        } else {
          loadPromise = window.loadFile(options.rendererPath, {
            query: { view: 'raw', rawId: String(rawId) },
          });
        }
        pendingLoads.set(rawId, loadPromise);
        await loadPromise;
      } catch (error) {
        if (windows.get(rawId) === window) windows.delete(rawId);
        if (!window.isDestroyed()) window.close();
        throw error;
      } finally {
        if (loadPromise && pendingLoads.get(rawId) === loadPromise) pendingLoads.delete(rawId);
      }
    },
    getRawId(sender) {
      let boundRawId: number | null = null;
      windows.forEach((window, rawId) => {
        if (boundRawId == null && !window.isDestroyed() && window.webContents === sender) {
          boundRawId = rawId;
        }
      });
      return boundRawId;
    },
    close(rawId) {
      const window = windows.get(rawId);
      windows.delete(rawId);
      pendingLoads.delete(rawId);
      if (window && !window.isDestroyed()) window.close();
    },
    closeAll() {
      for (const window of Array.from(windows.values())) {
        if (!window.isDestroyed()) window.close();
      }
      windows.clear();
      pendingLoads.clear();
    },
  };
}
