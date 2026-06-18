import { contextBridge, ipcRenderer } from 'electron';

const api = {
  addresses: {
    list: () => ipcRenderer.invoke('addresses:list'),
    add: (pattern: string, label?: string) =>
      ipcRenderer.invoke('addresses:add', pattern, label),
    remove: (id: number) => ipcRenderer.invoke('addresses:delete', id),
    toggle: (id: number, enabled: boolean) =>
      ipcRenderer.invoke('addresses:toggle', id, enabled),
  },
  conversations: {
    list: (addressId: number) => ipcRenderer.invoke('conversations:list', addressId),
    get: (id: number) => ipcRenderer.invoke('conversations:get', id),
  },
  messages: {
    list: (convId: number) => ipcRenderer.invoke('messages:list', convId),
  },
  raw: {
    get: (id: number) => ipcRenderer.invoke('raw:get', id),
  },
  proxy: {
    status: () => ipcRenderer.invoke('proxy:status'),
    enableSystem: () => ipcRenderer.invoke('proxy:enableSystem'),
    disableSystem: () => ipcRenderer.invoke('proxy:disableSystem'),
    isSystemEnabled: () => ipcRenderer.invoke('proxy:isSystemEnabled'),
    envLines: () => ipcRenderer.invoke('proxy:envLines'),
  },
  ca: {
    exportDer: () => ipcRenderer.invoke('ca:exportDer'),
    openFolder: () => ipcRenderer.invoke('ca:openFolder'),
  },
  app: {
    userDataDir: () => ipcRenderer.invoke('app:userDataDir'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  },
  on: (channel: 'capture:new' | 'proxy:status' | 'log:entry', handler: (payload: any) => void) => {
    const sub = (_e: any, payload: any) => handler(payload);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },
};

contextBridge.exposeInMainWorld('sniffer', api);

export type SnifferAPI = typeof api;