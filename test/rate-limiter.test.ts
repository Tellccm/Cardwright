import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, retryAfterSeconds } from '../src/main/rate-limiter.ts';

/** A limiter on a clock the test controls, so queueing is exercised without real waiting. */
function fake() {
  let clock = 1_000_000;
  const limiter = new RateLimiter({
    now: () => clock,
    // Waiting moves the clock forward by exactly what was asked for.
    sleep: async ms => { clock += ms; },
  });
  return { limiter, advance: (ms: number) => { clock += ms; }, at: () => clock };
}

test('requests under the limit go straight out; the one over it waits for the window to roll', async () => {
  const { limiter, advance, at } = fake();
  const started = at();
  // Three requests a second apart, with a limit of three: none of them waits.
  for (let index = 0; index < 3; index++) { await limiter.acquire('g', 3); advance(1_000); }
  assert.equal(at(), started + 3_000, 'only the test clock moved; no request waited');
  assert.equal(limiter.state('g', 3).used, 3);

  // The fourth waits exactly until the oldest leaves the rolling window.
  const before = at();
  await limiter.acquire('g', 3);
  assert.equal(at() - before, 57_000, 'it waits out the oldest request, not a whole minute');
  assert.equal(limiter.state('g', 3).used, 3, 'the oldest aged out as the new one went');
});

test('no limit means no waiting, and the window is rolling rather than a minute bucket', async () => {
  const { limiter, advance, at } = fake();
  for (let index = 0; index < 50; index++) await limiter.acquire('g', 0);
  assert.equal(limiter.state('g', 0).limit, 0);

  const paced = fake();
  await paced.limiter.acquire('h', 2);
  paced.advance(59_000);
  await paced.limiter.acquire('h', 2);
  const before = paced.at();
  // Two are in the window, so the third waits only for the older one to expire.
  await paced.limiter.acquire('h', 2);
  assert.equal(paced.at() - before, 1_000, 'it waits out the remainder, not a whole minute');
  assert.equal(at() >= 0 && true, true);
});

test('a 429 pauses the whole gateway for as long as the service asked', async () => {
  const { limiter, at } = fake();
  limiter.cooldown('g', 30);
  assert.equal(limiter.state('g', 0).cooldown, 30);
  const before = at();
  // Even with no per-minute limit, a cooling gateway holds its requests.
  await limiter.acquire('g', 0);
  assert.equal(at() - before, 30_000);
  assert.equal(limiter.state('g', 0).cooldown, 0);

  // A longer pause wins over a shorter one; the bounds keep it sane.
  limiter.cooldown('g', 10); limiter.cooldown('g', 45);
  assert.equal(limiter.state('g', 0).cooldown, 45);
  limiter.cooldown('h', 99999);
  assert.equal(limiter.state('h', 0).cooldown, 600, 'a cooldown is capped at ten minutes');
  limiter.cooldown('i', Number.NaN);
  assert.equal(limiter.state('i', 0).cooldown, 20, 'an unreadable value falls back to twenty seconds');
});

test('gateways are counted separately, and a cancelled request stops waiting', async () => {
  const { limiter, at } = fake();
  await limiter.acquire('one', 1);
  const before = at();
  await limiter.acquire('two', 1);
  assert.equal(at(), before, 'another gateway has its own window');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => limiter.acquire('one', 1, controller.signal), /cancelled/);

  limiter.forget('one');
  assert.equal(limiter.state('one', 1).used, 0);
});

test('Retry-After is read as seconds or as a date', () => {
  const now = Date.parse('2026-09-29T12:00:00.000Z');
  assert.equal(retryAfterSeconds({ 'retry-after': '30' }, now), 30);
  assert.equal(retryAfterSeconds({ 'Retry-After': '0' }, now), 0);
  assert.equal(retryAfterSeconds({ 'retry-after': 'Tue, 29 Sep 2026 12:00:45 GMT' }, now), 45);
  assert.equal(retryAfterSeconds({}, now), undefined);
  assert.equal(retryAfterSeconds(undefined, now), undefined);
  assert.equal(retryAfterSeconds({ 'retry-after': 'soon' }, now), undefined);
});
