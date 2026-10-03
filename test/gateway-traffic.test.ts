import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppStore } from '../src/core/store.ts';
import { boundedCooldown, keepLocalTraffic, trafficSettings, validRateLimit, validRetry, validStall } from '../src/shared/gateway-traffic.ts';

// The store, the save path, a backup restore and the editor check a gateway's traffic settings in one place.
test('the traffic settings are checked in one place', () => {
  assert.equal(validStall({ seconds: 15 }), true);
  assert.equal(validStall({ seconds: 300 }), true);
  for (const bad of [{ seconds: 14 }, { seconds: 301 }, { seconds: 900 }, { seconds: 30.5 }, { seconds: '60' }, {}, null, 60]) assert.equal(validStall(bad), false, JSON.stringify(bad));
  assert.equal(validRateLimit({ enabled: false, perMinute: 20 }), true, 'a limit that is switched off still keeps its number');
  for (const bad of [{ enabled: true, perMinute: 0 }, { enabled: 'yes', perMinute: 5 }, { enabled: true, perMinute: 10_001 }]) assert.equal(validRateLimit(bad), false, JSON.stringify(bad));
  assert.equal(validRetry({ maxRetries: 0 }), true);
  for (const bad of [{ maxRetries: -1 }, { maxRetries: 11 }, { maxRetries: 1.5 }]) assert.equal(validRetry(bad), false, JSON.stringify(bad));
  assert.deepEqual(
    trafficSettings({ upstream: 'auto', rateLimit: { enabled: true, perMinute: 5, extra: 1 }, retry: { maxRetries: 3 }, stall: { seconds: 60 } }),
    { rateLimit: { enabled: true, perMinute: 5 }, retry: { maxRetries: 3 }, stall: { seconds: 60 } },
    'auto is the absent upstream, and only the known fields are copied',
  );
});

// 1.2 kept these settings in memory only: the store's explicit list of gateway fields left them out, so a restart lost them.
test('a gateway’s upstream, request limit, retries and 无响应断开 survive a restart; unreadable values are dropped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cardwright-traffic-'));
  try {
    const base = { name: 'Relay', baseUrl: 'http://127.0.0.1:9/v1', modelId: 'm', protocol: 'openai-completions', reasoning: false, contextWindow: 300000, maxTokens: 4096, hasKey: true, defaultsVersion: 6, models: [{ id: 'm', reasoning: false, contextWindow: 300000, maxTokens: 4096 }] };
    await writeFile(join(dir, 'state.json'), JSON.stringify({ schemaVersion: 8, gateways: [
      { ...base, id: 'kept', upstream: 'nvidia', rateLimit: { enabled: true, perMinute: 30 }, retry: { maxRetries: 5 }, stall: { seconds: 90 } },
      { ...base, id: 'broken', upstream: 'nonsense', rateLimit: { enabled: 'yes', perMinute: 0 }, retry: { maxRetries: 11 }, stall: { seconds: 5 } },
    ] }));
    const store = new AppStore(dir);
    const traffic = (id: string) => { const gateway = store.state.gateways.find(item => item.id === id)!; return [gateway.upstream, gateway.rateLimit, gateway.retry, gateway.stall]; };
    assert.deepEqual(traffic('kept'), ['nvidia', { enabled: true, perMinute: 30 }, { maxRetries: 5 }, { seconds: 90 }]);
    assert.deepEqual(traffic('broken'), [undefined, undefined, undefined, undefined], 'what cannot be read is off rather than guessed at');
    store.save();
    const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).gateways.find((item: { id: string }) => item.id === 'kept');
    assert.deepEqual([saved.upstream, saved.rateLimit, saved.retry, saved.stall], ['nvidia', { enabled: true, perMinute: 30 }, { maxRetries: 5 }, { seconds: 90 }]);
    assert.deepEqual(new AppStore(dir).state.gateways.find(item => item.id === 'kept')!.stall, { seconds: 90 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('restoring a backup keeps the traffic settings this computer has, since a backup carries none', () => {
  const local = { upstream: 'nvidia' as const, rateLimit: { enabled: true, perMinute: 30 }, retry: { maxRetries: 4 }, stall: { seconds: 60 } };
  assert.deepEqual(keepLocalTraffic({ id: 'g', name: 'From the backup' }, local), { id: 'g', name: 'From the backup', ...local });
  assert.deepEqual(keepLocalTraffic({ id: 'g', name: 'New here' }, undefined), { id: 'g', name: 'New here' });
});

test('a cooldown lasts what the service asked, within one second and ten minutes, or twenty seconds when it said nothing', () => {
  assert.equal(boundedCooldown(7), 7);
  assert.equal(boundedCooldown(7.4), 7);
  assert.equal(boundedCooldown(0), 1);
  assert.equal(boundedCooldown(99999), 600);
  assert.equal(boundedCooldown(undefined), 20);
  assert.equal(boundedCooldown(Number.NaN), 20);
});

test('the gateway editor has 无响应断开 in seconds, empty for off, and sends it only when filled in', () => {
  const editor = readFileSync(join(process.cwd(), 'src', 'renderer', 'GatewayEditor.tsx'), 'utf8');
  assert.match(editor, /'无响应断开（秒）'/);
  assert.match(editor, /留空为关。模型长时间思考、没有输出时，可能被误判为卡住。/);
  assert.match(editor, /min=\{STALL_SECONDS\.min\} max=\{STALL_SECONDS\.max\}/);
  assert.match(editor, /validStall\(\{ seconds: stallSeconds \}\)/);
  assert.match(editor, /stall: \{ seconds: stallSeconds \}/);
});
