import { retryAfterSeconds } from '../shared/gateway-traffic.ts';

/**
 * What the fetch layer watches on the requests a worker sends to its own gateway.
 *
 * Every model request passes through the worker's brokered `globalThis.fetch` (network-broker.ts). The provider SDKs
 * throw on a non-2xx status before pi's `after_provider_response` hook runs, so a 429 — with its Retry-After — is
 * only ever seen here, before the SDK turns it into an error message. 无响应断开 is enforced here too: a relay that
 * goes quiet would otherwise hold the run for minutes.
 */
export interface GatewayWatch {
  /** Origins of the gateway's endpoints; requests anywhere else pass straight through. */
  origins: readonly string[];
  /** 无响应断开 in milliseconds: how long a request may receive nothing. Absent or 0 is off. */
  stallMs?: number;
  /** The gateway answered 429: the seconds its Retry-After asked for, or undefined when it gave none. */
  onRateLimited?: (retryAfter: number | undefined) => void;
}

/** The error a silent request ends with. pi retries a message with "timeout" in it; the rest says what happened. */
export function stallError(stallMs: number): Error {
  return new Error(`无响应断开：${stallMs / 1000} 秒没有收到任何数据，已断开连接（stream timeout）。`);
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

/**
 * A fetch for the gateway's own requests. It reports a 429, and with 无响应断开 on it cuts off a request that receives
 * nothing for `stallMs` — while waiting for the response to start, or for the next piece once the reader asks for
 * one. Time the reader spends not asking does not count. Other addresses, and a watch with nothing to do, pass
 * straight through.
 */
export function watchedFetch(native: typeof fetch, watch: GatewayWatch): typeof fetch {
  return async (input, init) => {
    const stallMs = watch.stallMs ?? 0;
    if ((!watch.onRateLimited && !stallMs) || !watch.origins.includes(requestUrl(input).origin)) return native(input, init);
    const observe = (response: Response) => {
      if (response.status === 429) watch.onRateLimited?.(retryAfterSeconds(Object.fromEntries(response.headers)));
      return response;
    };
    if (!stallMs) return observe(await native(input, init));

    // The request follows a controller of our own, so silence can end it. The caller's signal still stops it through
    // a listener on that signal, which lives as long as the caller can abort; cancelling the reader as well does not
    // depend on how undici links signals (runtime-network.test.ts: an abort after a garbage collection).
    const controller = new AbortController();
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let reader: ReadableStreamDefaultReader | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const forward = () => { controller.abort(caller?.reason); void reader?.cancel(caller?.reason).catch(() => undefined); };
    const settle = () => { clearTimeout(timer); caller?.removeEventListener('abort', forward); };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        const error = stallError(stallMs);
        controller.abort(error);
        void reader?.cancel(error).catch(() => undefined);
      }, stallMs);
    };
    if (caller?.aborted) controller.abort(caller.reason); else caller?.addEventListener('abort', forward, { once: true });

    arm();
    let response: Response;
    try { response = observe(await native(input, { ...init, signal: controller.signal })); }
    catch (error) { settle(); throw stalled ? stallError(stallMs) : error; }
    clearTimeout(timer);
    if (!response.body) { settle(); return response; }
    const source = response.body.getReader();
    reader = source;
    const body = new ReadableStream({
      async pull(out) {
        arm();
        let chunk: Awaited<ReturnType<typeof source.read>>;
        try { chunk = await source.read(); }
        catch (error) { settle(); out.error(stalled ? stallError(stallMs) : error); return; }
        clearTimeout(timer);
        if (stalled) { settle(); out.error(stallError(stallMs)); return; }
        if (caller?.aborted) { settle(); out.error(caller.reason); return; }
        if (chunk.done) { settle(); out.close(); } else out.enqueue(chunk.value);
      },
      cancel(reason) { settle(); return source.cancel(reason); },
    }, { highWaterMark: 0 });
    const watched = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(watched, 'url', { value: response.url });
    return watched;
  };
}
