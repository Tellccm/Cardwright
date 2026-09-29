import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUsageReport, mergeUsageLedger, summarizeTaskUsage } from '../src/shared/usage.ts';
import type { Task } from '../src/shared/types.ts';

function task(id: string, at: string, tokens: number, extra: Partial<Task> = {}): Task {
  return {
    id, projectId: 'p', title: `Task ${id}`, cwd: 'C:/x', status: 'completed', permission: 'ask',
    gatewayId: 'g', thinking: 'medium', createdAt: at, updatedAt: at, tools: [],
    messages: [
      { id: `${id}-u`, role: 'user', text: 'hi', at },
      { id: `${id}-a`, role: 'assistant', text: 'ok', at, model: 'test-model', usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ],
    ...extra,
  } as Task;
}

test('a deleted task keeps its tokens on the day it spent them', () => {
  const day = '2026-09-20T10:00:00.000Z';
  const kept = task('kept', day, 100);
  const gone = task('gone', day, 400);

  const before = buildUsageReport([kept, gone], { now: Date.parse('2026-09-21T10:00:00.000Z'), days: 7 });
  assert.equal(before.tokens.total, 500);

  // Deleting folds the task into the ledger instead of dropping its counts.
  const ledger = mergeUsageLedger([], summarizeTaskUsage([gone]));
  const after = buildUsageReport([kept], { now: Date.parse('2026-09-21T10:00:00.000Z'), days: 7, ledger });
  assert.equal(after.tokens.total, 500, 'the day still costs what it cost');
  assert.equal(after.deleted.total, 400);
  assert.deepEqual(after.tasks.map(item => item.id), ['kept'], 'the deleted task has no entry of its own');
  const spentDay = after.days.find(entry => entry.tokens.total > 0)!;
  assert.equal(spentDay.deleted.total, 400);
  assert.equal(after.models.find(model => model.model === 'test-model')!.tokens.total, 500);
});

test('ledger days merge by date and never double-count a model', () => {
  const first = summarizeTaskUsage([task('a', '2026-09-20T10:00:00.000Z', 100)]);
  const second = summarizeTaskUsage([task('b', '2026-09-20T18:00:00.000Z', 50), task('c', '2026-09-21T09:00:00.000Z', 25)]);
  const merged = mergeUsageLedger(first, second);
  assert.deepEqual(merged.map(entry => entry.date).sort(), [...new Set(merged.map(entry => entry.date))].sort());
  const total = merged.reduce((sum, entry) => sum + entry.tokens.total, 0);
  assert.equal(total, 175);
  for (const entry of merged) assert.equal(entry.models.length, 1, 'one model entry per day, not one per task');
});

test('checkpoints of deleted tasks go, and the blobs nothing else refers to go with them', async () => {
  const { CheckpointService } = await import('../src/core/checkpoints.ts');
  const dir = mkdtempSync(join(tmpdir(), 'cardwright-delete-'));
  try {
    const project = join(dir, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'shared.txt'), 'both tasks see this');
    const service = new CheckpointService(dir);
    const doomed = await service.capture('doomed', 'turn-1', project);
    // A second checkpoint of another task refers to the same content.
    const kept = await service.capture('kept', 'turn-1', project);
    const sharedHash = Object.values(doomed.files)[0].hash;
    assert.equal(Object.values(kept.files)[0].hash, sharedHash);

    writeFileSync(join(project, 'only-doomed.txt'), 'nothing else refers to this');
    const second = await service.capture('doomed', 'turn-2', project);
    const loneHash = Object.entries(second.files).find(([path]) => path.endsWith('only-doomed.txt'))![1].hash;

    await service.removeForTasks(['doomed']);
    assert.deepEqual((await service.list('doomed')), []);
    assert.equal((await service.list('kept')).length, 1, 'another task keeps its own checkpoint');
    // Shared content survives; content only the deleted task referred to is reclaimed.
    assert.ok(existsSync(join(dir, 'checkpoints', 'blobs', sharedHash.slice(0, 2), sharedHash)));
    assert.equal(existsSync(join(dir, 'checkpoints', 'blobs', loneHash.slice(0, 2), loneHash)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
