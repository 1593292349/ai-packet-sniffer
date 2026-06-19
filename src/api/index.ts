/**
 * 渲染端 API 封装层
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
    remove: (id: number) => window.sniffer.conversations.remove(id),
    clear: (addressId: number) => window.sniffer.conversations.clear(addressId),
  },
  messages: {
    list: (convId: number) => window.sniffer.messages.list(convId),
  },
  raw: {
    open: (id: number) => window.sniffer.raw.open(id),
  },
  proxy: {
    status: () => window.sniffer.proxy.status(),
    enableSystem: () => window.sniffer.proxy.enableSystem(),
    disableSystem: () => window.sniffer.proxy.disableSystem(),
    setEnvPermanent: () => window.sniffer.proxy.setEnvPermanent(),
    unsetEnvPermanent: () => window.sniffer.proxy.unsetEnvPermanent(),
    envStatus: () => window.sniffer.proxy.envStatus(),
  },
  on: (channel: 'capture:new' | 'proxy:status' | 'log:entry', handler: (payload: any) => void) =>
    window.sniffer.on(channel, handler),
};

export type Api = typeof api;