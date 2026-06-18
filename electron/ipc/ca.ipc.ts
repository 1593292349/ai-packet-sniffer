import * as path from 'node:path';
import * as fs from 'node:fs';
import type { IpcContext } from './context';
import { exportCaAsDer } from '../ca';

export function registerCaIpc(ctx: IpcContext) {
  const { ipcMain, app, proxy, shell } = ctx;

  ipcMain.handle('ca:exportDer', async () => {
    const derPath = path.join(app.getPath('userData'), 'ca', 'sniffer-ca.crt');
    exportCaAsDer((proxy as any).ca, derPath);
    shell.showItemInFolder(derPath);
    return derPath;
  });

  ipcMain.handle('ca:openFolder', () => {
    const dir = path.join(app.getPath('userData'), 'ca');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return dir;
  });
}