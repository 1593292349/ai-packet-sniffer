/**
 * 渲染端 API 封装层
 * 所有 IPC 调用都通过这里，前端组件不直接调 window.sniffer
 * 便于以后切换实现（比如走 HTTP / WebSocket）
 */
import type { SnifferAPI } from '../../electron/preload';

declare global {
  interface Window {
    sniffer: SnifferAPI;
  }
}

export const api = {
  addresses: {
    list: () => window.sniffer.addresses.list(),
    add: (pattern: string, label?: string) =>
      window.sniffer.addresses.add(pattern, label),
    remove: (id: number) => window.sniffer.addresses.remove(id),
    toggle: (id: number, enabled: boolean) =>
      window.sniffer.addresses.toggle(id, enabled),
  },
  conversations: {
    list: (addressId: number) => window.sniffer.conversations.list(addressId),
    get: (id: number) => window.sniffer.conversations.get(id),
  },
  messages: {
    list: (convId: number) => window.sniffer.messages.list(convId),
  },
  raw: {
    get: (id: number) => window.sniffer.raw.get(id),
  },
  proxy: {
    status: () => window.sniffer.proxy.status(),
    enableSystem: () => window.sniffer.proxy.enableSystem(),
    disableSystem: () => window.sniffer.proxy.disableSystem(),
    isSystemEnabled: () => window.sniffer.proxy.isSystemEnabled(),
    envLines: () => window.sniffer.proxy.envLines(),
  },
  ca: {
    exportDer: () => window.sniffer.ca.exportDer(),
    openFolder: () => window.sniffer.ca.openFolder(),
  },
  app: {
    userDataDir: () => window.sniffer.app.userDataDir(),
    openExternal: (url: string) => window.sniffer.app.openExternal(url),
  },
  on: (channel: 'capture:new' | 'proxy:status' | 'log:entry', handler: (payload: any) => void) =>
    window.sniffer.on(channel, handler),
};

export type Api = typeof api;