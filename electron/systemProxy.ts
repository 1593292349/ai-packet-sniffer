/**
 * 系统代理管理（Windows 优先，使用 netsh）
 * Linux/macOS 提示用户手动 export。
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ProxyState {
  enabled: boolean;
  host: string;
  port: number;
}

export async function setWindowsProxy(host: string, port: number): Promise<void> {
  const server = `${host}:${port}`;
  // winhttp 开启代理；curl/大多数 CLI 走 http_proxy 环境变量
  const cmd1 = `netsh winhttp set proxy proxy-server="${server}" bypass-list="localhost;127.*;<local>"`;
  await execAsync(cmd1);
}

export async function unsetWindowsProxy(): Promise<void> {
  await execAsync(`netsh winhttp reset proxy`).catch(() => {});
}

export async function isWindowsProxyActive(host: string, port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`netsh winhttp show proxy`);
    return stdout.includes(`${host}:${port}`);
  } catch {
    return false;
  }
}

export function proxyEnvLines(host: string, port: number): string[] {
  return [
    `# AI Packet Sniffer 代理环境变量`,
    `set HTTP_PROXY=http://${host}:${port}`,
    `set HTTPS_PROXY=http://${host}:${port}`,
    `set ALL_PROXY=http://${host}:${port}`,
    `set NODE_EXTRA_CA_CERTS=${host === '127.0.0.1' ? '%USERPROFILE%\\AppData\\Roaming\\ai-packet-sniffer\\ca\\ca.crt.pem' : ''}`,
  ];
}