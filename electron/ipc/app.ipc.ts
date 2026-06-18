import type { IpcContext } from './context';

export function registerAppIpc(ctx: IpcContext) {
  const { ipcMain, app, shell } = ctx;
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url));
  ipcMain.handle('app:userDataDir', () => app.getPath('userData'));
}