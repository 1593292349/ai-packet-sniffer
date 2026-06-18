/**
 * IPC handler 注册
 * 把所有 ipcMain.handle 按主题拆到不同文件
 * 每个文件只负责一个域
 */
import type { IpcContext } from './context';

export function registerAddressIpc(ctx: IpcContext) {
  const { ipcMain, store } = ctx;
  ipcMain.handle('addresses:list', () => store.addresses.list());
  ipcMain.handle('addresses:add', (_e, pattern: string, label?: string) => {
    if (!pattern || typeof pattern !== 'string') throw new Error('pattern 必填');
    return store.addresses.add(pattern.trim(), label?.trim());
  });
  ipcMain.handle('addresses:delete', (_e, id: number) => {
    store.addresses.delete(id);
    return true;
  });
  ipcMain.handle('addresses:toggle', (_e, id: number, enabled: boolean) => {
    store.addresses.toggle(id, enabled);
    return true;
  });
}