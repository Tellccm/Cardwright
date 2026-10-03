import { boundedCooldown } from '../shared/gateway-traffic.ts';

/**
 * 每分钟请求上限 and 网关冷却.
 *
 * Every model request a gateway makes passes through here, whichever task or
 * squad member started it, because a service counts them against one key. A
 * request that would exceed the limit waits on this computer instead of being
 * sent and refused.
 *
 * The window is a rolling 60 seconds over the moments requests actually left,
 * not a bucket that resets on the minute, so a burst cannot slip through a
 * boundary. Retries count: the service counts them too.
 */
export interface RateLimitState {
  /** Requests sent in the last 60 seconds. */
  used: number;
  /** The configured ceiling, or 0 when the gateway has no limit. */
  limit: number;
  /** Seconds left on a 网关冷却, or 0. */
  cooldown: number;
  /** Requests waiting for a slot. */
  waiting: number;
}

/** Why a request waits for its slot, and until when, in the limiter's clock (1.3.0 §5.5 网络状态). */
export interface SlotWait { reason: 'limit' | 'cooldown'; until: number }

const WINDOW = 60_000;

interface Gate { sent: number[]; waiting: number; cooldownUntil: number; queue: Array<() => void> }

export class RateLimiter {
  private gates = new Map<string, Gate>();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The clock and the wait are injectable so the queueing can be tested without real time. */
  constructor(options: { now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms, signal) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, ms);
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('This request was cancelled while it waited for a rate-limit slot.')); };
      function done() { signal?.removeEventListener('abort', abort); resolve(); }
      signal?.addEventListener('abort', abort, { once: true });
    }));
  }

  private gate(gatewayId: string): Gate {
    let gate = this.gates.get(gatewayId);
    if (!gate) { gate = { sent: [], waiting: 0, cooldownUntil: 0, queue: [] }; this.gates.set(gatewayId, gate); }
    gate.sent = gate.sent.filter(at => at > this.now() - WINDOW);
    return gate;
  }

  /** Milliseconds until the next request may go out, or 0 when one may go now. */
  delayFor(gatewayId: string, limit: number): number { return this.wait(this.gate(gatewayId), limit).ms; }
  private wait(gate: Gate, limit: number): { ms: number; reason: SlotWait['reason'] } {
    const now = this.now();
    const cooling = Math.max(0, gate.cooldownUntil - now);
    if (cooling > 0) return { ms: cooling, reason: 'cooldown' };
    if (limit <= 0 || gate.sent.length < limit) return { ms: 0, reason: 'limit' };
    return { ms: Math.max(1, gate.sent[gate.sent.length - limit] + WINDOW - now), reason: 'limit' };
  }

  /**
   * Takes a slot, waiting if the gateway is at its limit or cooling down; `onWait` hears each wait before it begins.
   * Resolves once the request may be sent; rejects if the caller gives up.
   */
  async acquire(gatewayId: string, limit: number, signal?: AbortSignal, onWait?: (wait: SlotWait) => void): Promise<void> {
    if (limit <= 0 && !this.gates.get(gatewayId)?.cooldownUntil) { this.gate(gatewayId).sent.push(this.now()); return; }
    const gate = this.gate(gatewayId);
    for (;;) {
      if (signal?.aborted) throw new Error('This request was cancelled while it waited for a rate-limit slot.');
      const { ms, reason } = this.wait(gate, limit);
      if (ms <= 0) { gate.sent.push(this.now()); return; }
      onWait?.({ reason, until: this.now() + ms });
      gate.waiting++;
      try { await this.sleep(ms, signal); } finally { gate.waiting--; }
      this.gate(gatewayId);
    }
  }

  /**
   * The service said it was receiving too many requests, so the whole gateway
   * pauses for as long as it asked, rather than each request retrying alone.
   */
  cooldown(gatewayId: string, seconds: number): void {
    const bounded = boundedCooldown(seconds);
    const gate = this.gate(gatewayId);
    gate.cooldownUntil = Math.max(gate.cooldownUntil, this.now() + bounded * 1000);
  }

  /** When the gateway's 网关冷却 ends, in the limiter's clock; 0 when it never cooled down. */
  cooldownUntil(gatewayId: string): number { return this.gates.get(gatewayId)?.cooldownUntil ?? 0; }

  state(gatewayId: string, limit: number): RateLimitState {
    const gate = this.gate(gatewayId);
    return { used: gate.sent.length, limit: Math.max(0, limit), cooldown: Math.ceil(Math.max(0, gate.cooldownUntil - this.now()) / 1000), waiting: gate.waiting };
  }

  /** Forgets a gateway that was removed or reconfigured. */
  forget(gatewayId: string): void { this.gates.delete(gatewayId); }
}
