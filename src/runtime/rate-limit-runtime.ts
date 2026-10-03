import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * Holds each model request until the desktop process says a slot is free.
 *
 * The count belongs to the gateway, not to this task, so the decision is made
 * in the main process where every worker meets. This hook is the one place
 * every request passes through, whichever code path started it: a turn, a
 * squad member, a compaction summary or a one-click run.
 *
 * A 429 is not read here: the provider SDKs throw on a non-2xx status before
 * `after_provider_response` runs, so the fetch layer reports it instead
 * (gateway-watch.ts).
 */
export function createRateLimitExtension(options: {
  slot: (signal?: AbortSignal) => Promise<void>;
}): ExtensionFactory {
  return pi => {
    pi.on('before_provider_request', async (_event, ctx) => {
      // The wait follows the run, so a stopped run leaves the queue at once. The desktop process refuses or gives up
      // a slot only while the task is stopping; the request that follows is aborted with the run, so nothing goes out
      // and there is no extension failure to report.
      try { await options.slot(ctx.signal); }
      catch { /* the task is stopping */ }
    });
  };
}
