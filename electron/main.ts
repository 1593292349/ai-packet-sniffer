/**
 * Electron 主进程入口
 * 责任：组装（不写业务逻辑）
 *   - 单实例锁
 *   - 启动 Store / Proxy / Logger
 *   - 注册 IPC
 *   - 创建 BrowserWindow
 */
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import * as path from 'node:path';
import { Store } from './store';
import { MitmProxy, CaptureContext } from './proxy';
import { Logger } from './logger';
import { CaptureService } from './capture';
import { registerAllIpc, IpcContext } from './ipc';

const isDev = process.env.NODE_ENV === 'development';

// 单实例锁：防止两个 Electron 进程同时占用 7890
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let store: Store;
let proxy: MitmProxy;
let logger: Logger;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'AI Packet Sniffer',
    backgroundColor: '#ededed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 实时日志推送到前端
  if (logger) {
    logger.on((entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log:entry', entry);
      }
    });
  }
}

async function bootstrap() {
  const userData = app.getPath('userData');

  // 1. Logger
  logger = new Logger(path.join(userData, 'logs'));

  // 2. Store
  const dbPath = path.join(userData, 'store.json');
  store = new Store(dbPath);
  logger.info('store loaded', { path: dbPath });

  // 3. Proxy（端口冲突自动递增）
  const startPort = parseInt(process.env.SNIFFER_PORT || '7890', 10);
  let success = false;
  let lastErr: any = null;
  for (let p = startPort; p < startPort + 20; p++) {
    const candidate = new MitmProxy(userData, p);
    const captureService = new CaptureService(store, () => mainWindow, logger);
    candidate.setHandler((ctx: CaptureContext) => captureService.handle(ctx));
    try {
      await candidate.start();
      proxy = candidate;
      logger.info('proxy listening', { port: proxy.getPort() });
      success = true;
      break;
    } catch (e) {
      logger.warn('proxy port busy, trying next', { port: p });
      lastErr = e;
    }
  }
  if (!success) {
    logger.error('failed to bind any port', { error: String(lastErr) });
    throw lastErr;
  }

  // 4. IPC
  const ctx: IpcContext = {
    ipcMain,
    app,
    shell,
    store,
    proxy,
    getMainWindow: () => mainWindow,
  };
  registerAllIpc(ctx);
  logger.info('IPC registered');
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  try {
    await bootstrap();
  } catch (e) {
    console.error('[main] bootstrap failed', e);
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  try {
    if (proxy) await proxy.stop();
    if (store) store.close();
    if (logger) logger.close();
  } catch {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try {
    if (proxy) await proxy.stop();
    if (store) store.close();
    if (logger) logger.close();
  } catch {}
});