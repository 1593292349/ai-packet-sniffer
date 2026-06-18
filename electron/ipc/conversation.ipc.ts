import type { IpcContext } from './context';

export function registerConversationIpc(ctx: IpcContext) {
  const { ipcMain, store } = ctx;
  ipcMain.handle('conversations:list', (_e, addressId: number) =>
    store.conversations.listByAddress(addressId),
  );
  ipcMain.handle('conversations:get', (_e, id: number) => store.conversations.getById(id));
  ipcMain.handle('messages:list', (_e, convId: number) => store.messages.listByConversation(convId));
  ipcMain.handle('raw:get', (_e, id: number) => store.raws.getById(id));
}