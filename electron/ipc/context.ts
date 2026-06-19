/**
 * IPC handler 依赖注入上下文
 * 各个 ipc 文件共享这同一份依赖
 */
import type { IpcMain, App, Shell, BrowserWindow } from 'electron';
import type { Store } from '../store';
import type { MitmProxy } from '../proxy';
import type { RawWindowManager } from '../rawWindow';

export interface IpcContext {
  ipcMain: IpcMain;
  app: App;
  shell: Shell;
  store: Store;
  proxy: MitmProxy;
  getMainWindow: () => BrowserWindow | null;
  rawWindows: RawWindowManager;
}