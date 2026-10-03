import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableAssistantError, type AssistantMessage } from '@earendil-works/pi-ai';
import { createRelayRetryExtension, retryableRelayError, RETRY_NOTE } from '../src/runtime/relay-retry.ts';

const failed = (errorMessage: string): AssistantMessage => ({
  role: 'assistant', content: [], api: 'openai-completions', provider: 'relay', model: 'relay-model',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'error', errorMessage, timestamp: 0,
});

/** What a relay writes when the service behind it answered with this status and it can only say "upstream error". */
const upstreamBody = (status: number) => `{"message":"bad response status code ${status}","type":"upstream_error","param":"","code":"bad_response_status_code"}`;

/** What relays say for a temporary failure that pi's own list does not catch. */
const TEMPORARY = [
  '上游服务繁忙，请稍后重试', '当前分组上游负载已饱和，请稍后再试', '请求超时', '系统繁忙', '请求过于频繁，请稍后再试',
  '网络异常，连接被重置', '服务暂时不可用', 'upstream error: do request failed', 'no healthy upstream', 'Bad Gateway',
  'Gateway Time-out', 'The server is busy, please try again later.', 'Model is at capacity', 'read ECONNRESET',
  '520: unknown error', 'Request throttled',
  // A busy region is the moment, not the user's region being refused.
  '该地区节点繁忙，请稍后重试', 'upstream error: region us-east-1 is busy',
  // The two bare wordings: nothing in them says whose fault it is.
  'upstream error', '上游错误',
  // The statuses that can pass (timeout, conflict, too early): a relay's "upstream error" behind one is still worth a retry.
  ...[408, 409, 425].map(status => `${status}: ${upstreamBody(status)}`), `OpenAI API error (408): ${upstreamBody(408)}`,
];

/** Failures of the key, the balance or the request itself: a retry only repeats them. */
const PERMANENT = [
  '该令牌额度已用尽', '额度不足，请稍后再试', '无效的令牌', '模型不存在', 'Invalid API key provided', '内容审核未通过，请稍后重试',
  '上下文长度超出限制，请稍后重试', '400 上游返回错误：invalid model', 'insufficient_quota: please try again later',
  'prompt is too long: 213462 tokens > 200000 maximum',
  // A 4xx a relay calls only an "upstream error" is still the key, the balance, the permission or the request, in pi-ai's three ways to write a status.
  ...[400, 401, 402, 403].map(status => `${status}: ${upstreamBody(status)}`),
  `401 ${upstreamBody(401)}`, `OpenAI API error (401): ${upstreamBody(401)}`, `Mistral API error (403): ${upstreamBody(403)}`,
  // The content or the account was refused, whatever the relay calls it.
  '上游返回错误：内容包含违禁词', 'upstream error: Content Exists Risk', 'upstream error: the request was considered high risk',
  'upstream error: the prompt contains inappropriate content', 'upstream error: sensitive words detected',
  '上游错误：账户已被封禁', 'upstream error: account suspended', 'upstream error: your account has been banned',
  'upstream error: account disabled', 'upstream error: account deactivated',
  '该服务不可用于您所在的地区', 'upstream error: this service is not available in your region',
];

test('a relay’s temporary failure gets a note that makes pi retry it, and keeps what the relay said', () => {
  for (const text of TEMPORARY) {
    assert.equal(isRetryableAssistantError(failed(text)), false, `pi already retries "${text}"; it does not belong in this list`);
    const retried = retryableRelayError(failed(text), 32000);
    assert.ok(retried, `"${text}" should be retried`);
    assert.equal(retried.errorMessage, `${text}\n${RETRY_NOTE}`);
    assert.equal(isRetryableAssistantError(retried), true, `pi retries "${text}" once the note is on`);
  }
});

test('a failure of the key, the balance or the request is never retried, whatever else it says', () => {
  // Every offender at once, so one run says everything that gets through.
  assert.deepEqual(PERMANENT.filter(text => retryableRelayError(failed(text), 32000) !== undefined), [], 'these must not be retried');
});

test('what pi already retries, and anything that is not a failure, is left exactly as it was', () => {
  for (const text of [
    '503 Service Unavailable', '无响应断开：60 秒没有收到任何数据，已断开连接（stream timeout）。', 'fetch failed',
    // A 429 or a 5xx behind the same wrapper: pi's own list takes them, and the never-retry rules are not asked.
    ...[429, 500, 502].map(status => `${status}: ${upstreamBody(status)}`), `OpenAI API error (429): ${upstreamBody(429)}`,
  ]) {
    assert.equal(isRetryableAssistantError(failed(text)), true);
    assert.equal(retryableRelayError(failed(text), 32000), undefined);
  }
  assert.equal(retryableRelayError({ ...failed('上游服务繁忙'), stopReason: 'stop' }, 32000), undefined);
  assert.equal(retryableRelayError({ ...failed('上游服务繁忙'), stopReason: 'aborted' }, 32000), undefined);
});

test('the hook replaces only a failed assistant message', async () => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  createRelayRetryExtension(32000)({ on: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler) } as never);
  const end = handlers.get('message_end')!;
  const result = await end({ type: 'message_end', message: failed('系统繁忙') }) as { message: AssistantMessage };
  assert.equal(result.message.errorMessage, `系统繁忙\n${RETRY_NOTE}`);
  assert.equal(await end({ type: 'message_end', message: { role: 'user', content: '系统繁忙', timestamp: 0 } }), undefined);
});
