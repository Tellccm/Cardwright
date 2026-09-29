import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * 请求诊断 — what actually went out, so a gateway refusal can be read.
 *
 * A strict service answers an unknown field with a bare "400 status code (no
 * body)", and a relay in front of it often drops the detail that would name the
 * field. Without this the user is left guessing, which is exactly what happened
 * with `prompt_cache_key` before 1.2.0.
 *
 * Only the shape of the request is kept: the parameter names and their scalar
 * values, the tool names, and how many messages of each role there were. No
 * message text, no tool arguments, no system prompt, no credential — those live
 * in the headers and the body that this deliberately does not copy.
 */
export interface RequestDiagnostic {
  at: string;
  /** Request parameters with their scalar values; objects and arrays become a short description. */
  params: Record<string, string>;
  /** Names only, in the order sent, because tool order decides cache eligibility. */
  tools: string[];
  messages: { total: number; byRole: Record<string, number> };
  /** The HTTP status, once the response comes back. */
  status?: number;
  /** Response headers worth reading back: rate limits, request ids, retry hints. */
  headers?: Record<string, string>;
}

const KEEP_HEADERS = [
  'retry-after', 'x-request-id', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests',
  'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-requests', 'content-type',
];

/** A scalar becomes itself; anything larger becomes a description of its size. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.length} items]`;
  switch (typeof value) {
    case 'string': return value.length > 80 ? `"…" (${value.length} characters)` : JSON.stringify(value);
    case 'number': case 'boolean': return String(value);
    case 'object': return `{${Object.keys(value as object).join(', ')}}`;
    default: return typeof value;
  }
}

export function summarizeRequest(payload: unknown): RequestDiagnostic | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const request = payload as Record<string, unknown>;
  const params: Record<string, string> = {};
  const byRole: Record<string, number> = {};
  let total = 0;
  for (const [key, value] of Object.entries(request)) {
    // The conversation and the tool definitions are summarized, never copied.
    if (key === 'messages' || key === 'input') {
      if (!Array.isArray(value)) continue;
      total = value.length;
      for (const message of value) {
        const role = message && typeof message === 'object' && 'role' in message ? String((message as { role: unknown }).role) : 'other';
        byRole[role] = (byRole[role] ?? 0) + 1;
      }
      continue;
    }
    if (key === 'tools' || key === 'system' || key === 'instructions') continue;
    params[key] = describe(value);
  }
  const tools = Array.isArray(request.tools)
    ? request.tools.map(tool => {
      const record = tool as { name?: unknown; function?: { name?: unknown } };
      return String(record?.function?.name ?? record?.name ?? 'tool');
    })
    : [];
  // Anthropic keeps the system prompt out of messages; note that it was present.
  if (typeof request.system === 'string' || Array.isArray(request.system)) params.system = describe(request.system);
  return { at: new Date().toISOString(), params, tools, messages: { total, byRole } };
}

/** Records the last request of each turn and the status it came back with. */
export function createRequestLogExtension(record: (diagnostic: RequestDiagnostic) => void): ExtensionFactory {
  return pi => {
    let last: RequestDiagnostic | undefined;
    pi.on('before_provider_request', event => {
      last = summarizeRequest(event.payload);
      if (last) record(last);
    });
    pi.on('after_provider_response', event => {
      if (!last) return;
      const headers: Record<string, string> = {};
      for (const name of KEEP_HEADERS) {
        const value = event.headers?.[name] ?? event.headers?.[name.toLowerCase()];
        if (typeof value === 'string' && value) headers[name] = value.slice(0, 200);
      }
      last = { ...last, status: event.status, ...(Object.keys(headers).length ? { headers } : {}) };
      record(last);
    });
  };
}
