/**
 * URL 与监听 pattern 的匹配规则
 *  - 输入形如 "https://api.minimaxi.com/anthropic" 或 "api.minimaxi.com" 或 "*.openai.com"
 *  - 把 pattern 归一化为 origin（scheme://host），再判断目标 URL 的 origin 是否命中
 */
import * as url from 'node:url';

export function patternToOrigin(pattern: string): string | null {
  try {
    let p = pattern.trim();
    if (!p) return null;
    if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
    const u = new URL(p);
    // 去掉路径只保留 origin（但保留 path 前缀匹配能力）
    const origin = u.origin;
    return origin;
  } catch {
    return null;
  }
}

/**
 * 判断目标 URL 是否命中 pattern。
 * pattern 支持：
 *   - origin（https://api.xx.com） -> 匹配该 origin 下所有路径
 *   - 含 path 前缀（https://api.xx.com/anthropic） -> 匹配该前缀
 */
export function matchesPattern(targetUrl: string, pattern: string): boolean {
  const origin = patternToOrigin(pattern);
  if (!origin) return false;
  // 提取 pattern 的 path 前缀
  let pathPrefix = '';
  try {
    let p = pattern.trim();
    if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
    const u = new URL(p);
    pathPrefix = u.pathname.replace(/\/+$/, '');
  } catch {}
  try {
    const u = new URL(targetUrl);
    if (u.origin !== origin) return false;
    if (pathPrefix && pathPrefix !== '/' && !u.pathname.startsWith(pathPrefix)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 给定完整 URL，找库中第一个 enabled 且匹配的 address
 */
export function findMatchingAddress(
  addresses: { id: number; pattern: string; enabled: number }[],
  targetUrl: string,
) {
  for (const a of addresses) {
    if (!a.enabled) continue;
    if (matchesPattern(targetUrl, a.pattern)) return a;
  }
  return null;
}

export function originOf(targetUrl: string): string {
  try {
    return new URL(targetUrl).origin;
  } catch {
    return '';
  }
}