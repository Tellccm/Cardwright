import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { netStatusText } from '../src/shared/net-status.ts';

const now = 1_000_000;

test('the network line counts down 排队 and 冷却 and names the retry attempt', () => {
  assert.equal(netStatusText(undefined, now), null);
  assert.equal(netStatusText({ state: 'queued', until: now + 41_200 }, now), '排队中，约 42 秒后继续');
  assert.equal(netStatusText({ state: 'cooldown', until: now + 7_000 }, now), '网关冷却中，还剩 7 秒');
  assert.equal(netStatusText({ state: 'retrying', attempt: 2, max: 3, until: now + 4_000 }, now), '请求没成功，正在重试（第 2/3 次）');
  assert.equal(netStatusText({ state: 'queued', until: now - 10 }, now), '排队中，马上继续', 'a time already past is not shown as 0 秒');
  assert.equal(netStatusText({ state: 'cooldown' }, now), '网关冷却中，马上继续');
  assert.equal(netStatusText({ state: 'retrying' }, now), '请求没成功，正在重试');
  assert.equal(netStatusText({ state: 'retrying', attempt: 1 }, now), '请求没成功，正在重试（第 1 次）');
});

test('the line follows the interface language', () => {
  const english = (en: string) => en;
  assert.equal(netStatusText({ state: 'queued', until: now + 5_000 }, now, english), 'Queued; continues in about 5 s');
  assert.equal(netStatusText({ state: 'cooldown', until: now + 7_000 }, now, english), 'Gateway cooling down; 7 s left');
  assert.equal(netStatusText({ state: 'retrying', attempt: 2, max: 3 }, now, english), 'Request failed; retrying (2/3)');
});

test('the workbench status line and the card studio composer show it, the composer above its box', () => {
  const statusline = readFileSync(join(process.cwd(), 'src', 'renderer', 'Statusline.tsx'), 'utf8');
  assert.match(statusline, /useNetStatusText\(task\?\.net\)/);
  assert.match(statusline, /task\.net\?\.state !== 'cooldown'/, 'the gateway’s own cooldown span gives way to the task’s');
  const composer = readFileSync(join(process.cwd(), 'src', 'renderer', 'card-studio', 'StudioComposer.tsx'), 'utf8');
  assert.match(composer, /useNetStatusText\(task\?\.net\)/);
  assert.ok(composer.indexOf('cs-composer-net') > 0 && composer.indexOf('cs-composer-net') < composer.indexOf('className="cs-composer-box"'));
});

// The hook's clock is set when a view opens. A passive effect corrected it only after a frame had been painted, so the
// first frame of a countdown added the time the view had been open to the real wait (28 s for a 25 s cooldown, in a
// view opened three seconds earlier).
test('the countdown hook corrects its clock before the first frame is painted', () => {
  const hook = readFileSync(join(process.cwd(), 'src', 'renderer', 'net-status.ts'), 'utf8');
  assert.match(hook, /useLayoutEffect\(/);
  assert.doesNotMatch(hook, /\buseEffect\(/);
});
