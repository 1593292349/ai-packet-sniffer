import { contextBridge, ipcRenderer } from 'electron';

const api = {
  addresses: {
    list: () => ipcRenderer.invoke('addresses:list'),
    add: (pattern: string, label?: string) => ipcRenderer.invoke('addresses:add', pattern, label),
    remove: (id: number) => ipcRenderer.invoke('addresses:delete', id),
    toggle: (id: number, enabled: boolean) => ipcRenderer.invoke('addresses:toggle', id, enabled),
  },
  conversations: {
    list: (addressId: number) => ipcRenderer.invoke('conversations:list', addressId),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('conversations:delete', id),
    clear: (addressId: number): Promise<void> =>
      ipcRenderer.invoke('conversations:clear', addressId),
  },
  messages: {
    list: (convId: number) => ipcRenderer.invoke('messages:list', convId),
  },
  raw: {
    open: (id: number): Promise<void> => ipcRenderer.invoke('raw:open', id),
  },
  proxy: {
    status: () => ipcRenderer.invoke('proxy:status'),
    enableSystem: () => ipcRenderer.invoke('proxy:enableSystem'),
    disableSystem: () => ipcRenderer.invoke('proxy:disableSystem'),
    setEnvPermanent: () => ipcRenderer.invoke('proxy:setEnvPermanent'),
    unsetEnvPermanent: () => ipcRenderer.invoke('proxy:unsetEnvPermanent'),
    envStatus: () => ipcRenderer.invoke('proxy:envStatus'),
  },
  on: (channel: 'capture:new' | 'proxy:status' | 'log:entry', handler: (payload: unknown) => void) => {
    const sub = (_e: Electron.IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },
};

contextBridge.exposeInMainWorld('sniffer', api);

export type SnifferAPI = typeof api;
