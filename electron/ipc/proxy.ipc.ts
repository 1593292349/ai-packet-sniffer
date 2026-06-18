import type { IpcContext } from './context';
import * as systemProxy from '../systemProxy';

export function registerProxyIpc(ctx: IpcContext) {
  const { ipcMain, proxy } = ctx;

  ipcMain.handle('proxy:status', () => ({
    port: proxy.getPort(),
    host: '127.0.0.1',
    caPath: proxy.getCaCertPath(),
  }));

  ipcMain.handle('proxy:enableSystem', async () => {
    await systemProxy.setWindowsProxy('127.0.0.1', proxy.getPort());
    return { ok: true };
  });
  ipcMain.handle('proxy:disableSystem', async () => {
    await systemProxy.unsetWindowsProxy();
    return { ok: true };
  });
  ipcMain.handle('proxy:isSystemEnabled', async () =>
    systemProxy.isWindowsProxyActive('127.0.0.1', proxy.getPort()),
  );
  ipcMain.handle('proxy:envLines', () =>
    systemProxy.proxyEnvLines('127.0.0.1', proxy.getPort()),
  );
}