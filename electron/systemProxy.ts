/**
 * Windows 系统代理管理
 *
 * 两套机制并行：
 *   1. 注册表 Internet Settings（LAN 代理）→ 控制浏览器、WinHTTP 客户端
 *   2. netsh winhttp（WinHTTP 代理）→ 控制 WinHTTP 程序
 *
 * 注册表方式**不需要管理员权限**，所以这里以注册表为主。
 * netsh winhttp 设为可选辅助（很多程序读它做 fallback）。
 *
 * 注意：这两套都只影响「走 WinHTTP/IE 设置的程序」，**不**影响：
 *   - 自己设 HTTP_PROXY 的进程（Node.js CLI 等）—— 需要用户手动 export
 *   - 应用内硬编码使用其他代理的进程
 *   - .NET HttpClient / WinINet 等
 */
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';

const execAsync = promisify(exec);

export interface ProxyState {
  enabled: boolean;
  host: string;
  port: number;
}

/**
 * 通过修改注册表设置/取消 LAN 代理
 * 不需要管理员权限
 * 注意：PowerShell 路径里用正斜杠（也兼容），避免 bash heredoc 反斜杠转义问题
 */
async function setRegistryProxy(host: string, port: number, enable: boolean): Promise<void> {
  const server = `${host}:${port}`;
  // 用单引号路径（PowerShell 中反斜杠不需转义），但保险起见用正斜杠
  const path = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings';

  const psScript = enable
    ? `Set-ItemProperty -Path '${path}' -Name ProxyServer -Value '${server}' -Force; ` +
      `Set-ItemProperty -Path '${path}' -Name ProxyEnable -Value 1 -Type DWord -Force`
    : `Set-ItemProperty -Path '${path}' -Name ProxyEnable -Value 0 -Type DWord -Force`;

  await execAsync(`powershell -NoProfile -Command "${psScript}"`);
}

/**
 * 读取当前注册表里的代理状态
 */
async function readRegistryProxy(): Promise<{ enabled: boolean; server: string | null }> {
  const path = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings';
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-ItemProperty -Path '${path}' -Name ProxyEnable,ProxyServer -ErrorAction SilentlyContinue | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress"`,
    );
    const text = stdout.trim();
    if (!text) return { enabled: false, server: null };
    const j = JSON.parse(text);
    return {
      enabled: j.ProxyEnable === 1 || j.ProxyEnable === true,
      server: j.ProxyServer || null,
    };
  } catch {
    return { enabled: false, server: null };
  }
}

/**
 * 启用系统代理：注册表 + netsh winhttp 双管齐下
 * netsh 在没有管理员权限时会失败，但不影响注册表生效
 */
export async function setWindowsProxy(host: string, port: number): Promise<{
  registry: boolean;
  netsh: boolean;
  netshError?: string;
}> {
  const result = { registry: false, netsh: false, netshError: undefined as string | undefined };

  // 1. 注册表（不需管理员）
  try {
    await setRegistryProxy(host, port, true);
    result.registry = true;
  } catch (e: any) {
    throw new Error(`设置注册表代理失败: ${e.message}`);
  }

  // 2. netsh winhttp（需管理员，失败不致命）
  try {
    await execAsync(
      `netsh winhttp set proxy proxy-server="${host}:${port}" bypass-list="localhost;127.*;<local>"`,
    );
    result.netsh = true;
  } catch (e: any) {
    result.netshError = e.message;
  }

  return result;
}

/**
 * 关闭系统代理
 */
export async function unsetWindowsProxy(): Promise<{
  registry: boolean;
  netsh: boolean;
  netshError?: string;
}> {
  const result = { registry: false, netsh: false, netshError: undefined as string | undefined };

  // 1. 注册表
  try {
    await setRegistryProxy('', 0, false);
    result.registry = true;
  } catch (e: any) {
    throw new Error(`关闭注册表代理失败: ${e.message}`);
  }

  // 2. netsh winhttp
  try {
    await execAsync(`netsh winhttp reset proxy`);
    result.netsh = true;
  } catch (e: any) {
    result.netshError = e.message;
  }

  return result;
}

/**
 * 检查系统代理状态
 * 返回是否开启、是否指向我们的 host:port
 */
export async function getProxyState(host: string, port: number): Promise<ProxyState> {
  // 注册表是主要真相源
  const reg = await readRegistryProxy();
  const target = `${host}:${port}`;
  const enabled = reg.enabled && reg.server !== null && reg.server.includes(target);

  // 如果注册表没匹配，再看 netsh（仅当 netsh 指向我们时算开启）
  if (!enabled) {
    try {
      const { stdout } = await execAsync(`netsh winhttp show proxy`);
      if (stdout.includes(target)) {
        return { enabled: true, host, port };
      }
    } catch {}
  }

  return { enabled, host, port };
}

/**
 * 直接从注册表 HKCU\Environment 读取变量，判断是否已配
 */
export function readEnvFromRegistry(): Record<string, string | null> {
  const result: Record<string, string> = {};
  const VALID = ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE','SSL_CERT_FILE'];
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$k=@('${VALID.join("','")}');$k|%{$v=Get-ItemProperty -Path 'HKCU:/Environment' -Name $_ -ErrorAction SilentlyContinue;if($v.$_){Write-Output \\\"$_=$($v.$_)\\\"}}"`,
      { encoding: 'utf8', stdio: 'pipe', timeout: 5000 },
    );
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const idx = line.indexOf('=');
      if (idx > 0) result[line.slice(0, idx)] = line.slice(idx + 1).trim().replace(/\r$/, '');
    }
  } catch {}
  // 补全未找到的变量为 null
  const final: Record<string, string | null> = {};
  for (const k of VALID) final[k] = result[k] || null;
  return final;
}

/** 单次 PowerShell 批量写入所有变量 */
export function setEnvLinesPermanent(host: string, port: number): {
  ok: boolean;
  vars: string[];
  error?: string;
} {
  const certPath = path.join(
    process.env.APPDATA || '',
    'ai-packet-sniffer',
    'ca',
    'ca.crt.pem',
  );
  const certExists = fs.existsSync(certPath);
  const server = `http://${host}:${port}`;

  const ps = certExists
    ? `$v=@{};$v.HTTP_PROXY='${server}';$v.HTTPS_PROXY='${server}';$v.ALL_PROXY='${server}';$v.NODE_EXTRA_CA_CERTS='${certPath.replace(/\\/g, '\\')}';$v.REQUESTS_CA_BUNDLE='${certPath.replace(/\\/g, '\\')}';$v.SSL_CERT_FILE='${certPath.replace(/\\/g, '\\')}';$v.Keys|%{Set-ItemProperty -Path 'HKCU:/Environment' -Name $_ -Value $v.$_}`
    : `$v=@{};$v.HTTP_PROXY='${server}';$v.HTTPS_PROXY='${server}';$v.ALL_PROXY='${server}';$v.Keys|%{Set-ItemProperty -Path 'HKCU:/Environment' -Name $_ -Value $v.$_}`;

  try {
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 8000 });
    // 通知系统环境变量刷新
    try {
      execSync(
        `powershell -NoProfile -Command "[Microsoft.Win32.SafeNativeMethods]::SendMessageTimeout(0xffff,0x001A,0,'Environment',2,1000,[ref]0)|Out-Null"`,
        { stdio: 'pipe', timeout: 3000 },
      );
    } catch {}
    return { ok: true, vars: certExists
      ? ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE','SSL_CERT_FILE']
      : ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'] };
  } catch (e: any) {
    return { ok: false, vars: [], error: e.message };
  }
}

/** 单次 PowerShell 批量删除所有变量 */
export function unsetEnvLinesPermanent(): { ok: boolean; removed: string[]; error?: string } {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$k=@('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE','SSL_CERT_FILE');$r=@();$k|%{$v=Get-ItemProperty -Path 'HKCU:/Environment' -Name $_ -ErrorAction SilentlyContinue;if($v.$_){Remove-ItemProperty -Path 'HKCU:/Environment' -Name $_; $r+=$_}};Write-Output ($r -join ',')"`,
      { encoding: 'utf8', stdio: 'pipe', timeout: 5000 },
    );
    const removed = out.trim().split(',').filter(Boolean);
    try {
      execSync(
        `powershell -NoProfile -Command "[Microsoft.Win32.SafeNativeMethods]::SendMessageTimeout(0xffff,0x001A,0,'Environment',2,1000,[ref]0)|Out-Null"`,
        { stdio: 'pipe', timeout: 3000 },
      );
    } catch {}
    return { ok: true, removed };
  } catch (e: any) {
    return { ok: false, removed: [], error: e.message };
  }
}