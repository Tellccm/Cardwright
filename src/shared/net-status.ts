import type { Task } from './types.ts';

type Translate = (english: string, chinese: string) => string;
const chinese: Translate = (_english, text) => text;

/**
 * One line for a task's 网络状态 (1.3.0 §5.5): 排队 (每分钟请求上限), 冷却 (429) or 重试. `now` is the caller's clock,
 * so a countdown re-renders every second without the desktop process publishing every second. Null when the task's
 * request is not held up. The workbench status line, the card studio composer and stage 4's member cards read it.
 */
export function netStatusText(net: Task['net'], now: number, t: Translate = chinese): string | null {
  if (!net) return null;
  const seconds = net.until ? Math.ceil((net.until - now) / 1000) : 0;
  if (net.state === 'queued') return seconds > 0 ? t(`Queued; continues in about ${seconds} s`, `排队中，约 ${seconds} 秒后继续`) : t('Queued; continuing shortly', '排队中，马上继续');
  if (net.state === 'cooldown') return seconds > 0 ? t(`Gateway cooling down; ${seconds} s left`, `网关冷却中，还剩 ${seconds} 秒`) : t('Gateway cooling down; continuing shortly', '网关冷却中，马上继续');
  const count = net.attempt && net.max ? `${net.attempt}/${net.max}` : net.attempt ? String(net.attempt) : '';
  return count ? t(`Request failed; retrying (${count})`, `请求没成功，正在重试（第 ${count} 次）`) : t('Request failed; retrying', '请求没成功，正在重试');
}
