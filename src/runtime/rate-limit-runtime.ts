import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * Holds each model request until the desktop process says a slot is free.
 *
 * The count belongs to the gateway, not to this task, so the decision is made
 * in the main process where every worker meets. This hook is the one place
 * every request passes through, whichever code path started it: a turn, a
 * squad member, a compaction summary or a one-click run.
 */
export function createRateLimitExtension(options: {
  slot: (signal?: AbortSignal) => Promise<void>;
  cooldown: (seconds: number) => void;
  notify: (message: string) => void;
}): ExtensionFactory {
  return pi => {
    pi.on('before_provider_request', async () => {
      await options.slot();
    });
    pi.on('after_provider_response', event => {
      if (event.status !== 429) return;
      const raw = event.headers?.['retry-after'] ?? event.headers?.['Retry-After'];
      const seconds = Number(raw);
      const at = raw ? Date.parse(raw) : NaN;
      const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds
        : Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000))
        : 20;
      options.cooldown(wait);
      options.notify(`服务器说请求太多了（429）。这个网关暂停 ${Math.max(1, Math.round(wait))} 秒后继续。`);
    });
  };
}
