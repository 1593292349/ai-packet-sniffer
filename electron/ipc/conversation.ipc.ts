import type { IpcContext } from './context';

function isTrustedRendererFrame(event: {
  sender: { mainFrame: unknown; getURL(): string };
  senderFrame?: { url: string };
}, rawId: number | null): boolean {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  if (event.senderFrame.url !== event.sender.getURL()) return false;
  try {
    const url = new URL(event.senderFrame.url);
    const fromRenderer =
      (url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html')) ||
      (url.protocol === 'http:' &&
        url.hostname === 'localhost' &&
        url.port === '5173' &&
        url.pathname === '/');
    if (!fromRenderer) return false;
    if (rawId == null) return !url.searchParams.has('view') && !url.searchParams.has('rawId');
    return url.searchParams.get('view') === 'raw' && url.searchParams.get('rawId') === String(rawId);
  } catch {
    return false;
  }
}

function isTrustedMainWindowEvent(
  ctx: IpcContext,
  event: {
    sender: { mainFrame: unknown; getURL(): string };
    senderFrame?: { url: string };
  },
): boolean {
  const mainWindow = ctx.getMainWindow();
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents &&
      isTrustedRendererFrame(event, null),
  );
}

export function registerConversationIpc(ctx: IpcContext) {
  const { ipcMain, store, rawWindows } = ctx;
  ipcMain.handle('conversations:list', (_e, addressId: number) =>
    store.conversations.listByAddress(addressId),
  );
  ipcMain.handle('messages:list', (_e, convId: number) => store.messages.listByConversation(convId));

  ipcMain.handle('conversations:delete', (event, id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0 || !isTrustedMainWindowEvent(ctx, event)) {
      throw new Error('无权删除该会话');
    }
    const result = store.conversations.delete(id);
    for (const rawId of result.rawIds) rawWindows.close(rawId);
  });

  ipcMain.handle('conversations:clear', (event, addressId: number) => {
    if (
      !Number.isSafeInteger(addressId) ||
      addressId <= 0 ||
      !isTrustedMainWindowEvent(ctx, event)
    ) {
      throw new Error('无权清空该地址的会话');
    }
    const result = store.conversations.clearByAddress(addressId);
    for (const rawId of result.rawIds) rawWindows.close(rawId);
  });

  ipcMain.handle('raw:get', async (event) => {
    const id = rawWindows.getRawId(event.sender);
    if (id == null || !isTrustedRendererFrame(event, id)) {
      throw new Error('无权读取该原始数据');
    }
    return store.raws.getById(id);
  });
  ipcMain.handle('raw:open', async (event, id: number) => {
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !isTrustedMainWindowEvent(ctx, event) ||
      !store.raws.getById(id)
    ) {
      throw new Error('无权打开该原始数据窗口');
    }
    await rawWindows.open(id);
  });
}