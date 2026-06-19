import type { IpcContext } from './context';
import * as systemProxy from '../systemProxy';

export function registerProxyIpc(ctx: IpcContext) {
  const { ipcMain, proxy } = ctx;

  ipcMain.handle('proxy:status', async () => {
    const port = proxy.getPort();
    return {
      port,
      host: '127.0.0.1',
      caPath: proxy.getCaCertPath(),
      system: await systemProxy.getProxyState('127.0.0.1', port),
    };
  });

  ipcMain.handle('proxy:enableSystem', async () => {
    try {
      return { ok: true, ...(await systemProxy.setWindowsProxy('127.0.0.1', proxy.getPort())) };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('proxy:disableSystem', async () => {
    try {
      return { ok: true, ...(await systemProxy.unsetWindowsProxy()) };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('proxy:setEnvPermanent', () => {
    return systemProxy.setEnvLinesPermanent('127.0.0.1', proxy.getPort());
  });

  ipcMain.handle('proxy:unsetEnvPermanent', () => {
    return systemProxy.unsetEnvLinesPermanent();
  });

  ipcMain.handle('proxy:envStatus', () => {
    return systemProxy.readEnvFromRegistry();
  });
}