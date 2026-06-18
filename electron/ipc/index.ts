/**
 * IPC 总入口：组合所有主题
 */
import type { IpcContext } from './context';
import { registerAddressIpc } from './address.ipc';
import { registerConversationIpc } from './conversation.ipc';
import { registerProxyIpc } from './proxy.ipc';
import { registerCaIpc } from './ca.ipc';
import { registerAppIpc } from './app.ipc';

export function registerAllIpc(ctx: IpcContext): void {
  registerAddressIpc(ctx);
  registerConversationIpc(ctx);
  registerProxyIpc(ctx);
  registerCaIpc(ctx);
  registerAppIpc(ctx);
}

export type { IpcContext } from './context';