import type { Gateway } from './types.ts';
import { isGatewayUpstream } from './gateway-upstream.ts';

/**
 * A gateway's traffic settings — 上游服务商, 每分钟请求上限, the retry count and 无响应断开 (1.3.0 §5.4).
 *
 * The store, the save path, a backup restore and the gateway editor all check them here, so a value one of them
 * accepts is never one another drops. 1.2 had no such list: the store's explicit gateway fields left these out, and
 * every restart lost them.
 */

/** 无响应断开: whole seconds; absent is off. A request already ends after 300 seconds of silence, so a longer value would never fire. */
export const STALL_SECONDS = { min: 15, max: 300 } as const;

export type TrafficSettings = Pick<Gateway, 'upstream' | 'rateLimit' | 'retry' | 'stall'>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function whole(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

export function validRateLimit(value: unknown): value is NonNullable<Gateway['rateLimit']> {
  return record(value) && typeof value.enabled === 'boolean' && whole(value.perMinute, 1, 10_000);
}

export function validRetry(value: unknown): value is NonNullable<Gateway['retry']> {
  return record(value) && whole(value.maxRetries, 0, 10);
}

export function validStall(value: unknown): value is NonNullable<Gateway['stall']> {
  return record(value) && whole(value.seconds, STALL_SECONDS.min, STALL_SECONDS.max);
}

/** The valid traffic settings of a gateway, copied field by field; anything unreadable is left out rather than guessed at. `auto` is the absent upstream. */
export function trafficSettings(gateway: { upstream?: unknown; rateLimit?: unknown; retry?: unknown; stall?: unknown }): TrafficSettings {
  const { upstream, rateLimit, retry, stall } = gateway;
  return {
    ...(isGatewayUpstream(upstream) && upstream !== 'auto' ? { upstream } : {}),
    ...(validRateLimit(rateLimit) ? { rateLimit: { enabled: rateLimit.enabled, perMinute: rateLimit.perMinute } } : {}),
    ...(validRetry(retry) ? { retry: { maxRetries: retry.maxRetries } } : {}),
    ...(validStall(stall) ? { stall: { seconds: stall.seconds } } : {}),
  };
}

/** 资料备份 keeps a fixed set of gateway fields without these, so a restore keeps what this computer has. */
export function keepLocalTraffic<T extends object>(incoming: T, existing: Parameters<typeof trafficSettings>[0] | undefined): T {
  return existing ? { ...trafficSettings(existing), ...incoming } : incoming;
}

/** Reads `Retry-After`, in seconds or as an HTTP date. */
export function retryAfterSeconds(headers: Record<string, string> | undefined, now = Date.now()): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - now) / 1000)) : undefined;
}

/** 网关冷却: what the service asked for, 1 to 600 seconds, or 20 when it gave nothing readable. */
export function boundedCooldown(seconds: number | undefined): number {
  return Math.min(600, Math.max(1, Math.round(Number.isFinite(seconds) ? seconds as number : 20)));
}
