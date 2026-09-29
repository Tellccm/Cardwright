import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLogExtension, summarizeRequest } from '../src/runtime/request-log.ts';

const payload = {
  model: 'test-model',
  stream: true,
  max_tokens: 64,
  temperature: 0.7,
  prompt_cache_key: 'session-abcdef',
  store: false,
  stream_options: { include_usage: true },
  messages: [
    { role: 'system', content: 'a long system prompt the user would not want pasted into a bug report' },
    { role: 'user', content: 'my private project details' },
    { role: 'assistant', content: [{ type: 'text', text: 'a reply' }] },
    { role: 'user', content: 'more private text' },
  ],
  tools: [{ type: 'function', function: { name: 'read', parameters: { secret: true } } }, { name: 'bash' }],
};

test('a diagnostic names the fields that were sent without copying anything private', () => {
  const summary = summarizeRequest(payload)!;
  // The field that caused the 400 is visible by name and value.
  assert.equal(summary.params.prompt_cache_key, '"session-abcdef"');
  assert.equal(summary.params.store, 'false');
  assert.equal(summary.params.max_tokens, '64');
  assert.equal(summary.params.stream_options, '{include_usage}');

  // Nothing the user wrote travels with it.
  const serialized = JSON.stringify(summary);
  for (const secret of ['private project details', 'more private text', 'long system prompt', 'a reply']) {
    assert.equal(serialized.includes(secret), false, `the diagnostic leaked: ${secret}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(summary.params, 'messages'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(summary.params, 'tools'), false);

  // The shape is still there: how many messages, of which roles, and which tools.
  assert.equal(summary.messages.total, 4);
  assert.deepEqual(summary.messages.byRole, { system: 1, user: 2, assistant: 1 });
  assert.deepEqual(summary.tools, ['read', 'bash']);
});

test('a long string is reduced to its length, and Anthropic’s separate system prompt is noted but not copied', () => {
  const summary = summarizeRequest({ model: 'm', system: 'x'.repeat(4000), messages: [] })!;
  assert.match(summary.params.system, /4000 characters/);
  assert.equal(summary.params.system.includes('xxxx'), false);
  const long = summarizeRequest({ model: 'm', note: 'y'.repeat(200), messages: [] })!;
  assert.match(long.params.note, /200 characters/);
});

test('the response status and the headers worth reading come back with it', () => {
  const recorded: Array<ReturnType<typeof summarizeRequest>> = [];
  const handlers = new Map<string, (event: any) => unknown>();
  createRequestLogExtension(diagnostic => recorded.push(diagnostic))({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);

  handlers.get('before_provider_request')!({ type: 'before_provider_request', payload });
  handlers.get('after_provider_response')!({ type: 'after_provider_response', status: 400, headers: { 'retry-after': '30', 'x-request-id': 'req-1', 'set-cookie': 'session=secret' } });

  const last = recorded[recorded.length - 1]!;
  assert.equal(last.status, 400);
  assert.equal(last.headers!['retry-after'], '30');
  assert.equal(last.headers!['x-request-id'], 'req-1');
  // Only an allowed list of headers is kept; a cookie is not one of them.
  assert.equal(Object.prototype.hasOwnProperty.call(last.headers!, 'set-cookie'), false);
  assert.equal(last.params.prompt_cache_key, '"session-abcdef"', 'the request shape survives the response');
});

test('a payload that is not an object is simply not recorded', () => {
  assert.equal(summarizeRequest(undefined), undefined);
  assert.equal(summarizeRequest('nonsense'), undefined);
  assert.equal(summarizeRequest(null), undefined);
});
