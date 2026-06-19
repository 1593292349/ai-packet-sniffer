/**
 * IPC 总入口：组合所有当前 UI 使用的主题。
 */
import type { IpcContext } from './context';
import { registerAddressIpc } from './address.ipc';
import { registerConversationIpc } from './conversation.ipc';
import { registerProxyIpc } from './proxy.ipc';

export function registerAllIpc(ctx: IpcContext): void {
  registerAddressIpc(ctx);
  registerConversationIpc(ctx);
  registerProxyIpc(ctx);
}

export type { IpcContext } from './context';
