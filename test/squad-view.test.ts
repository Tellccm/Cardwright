import test from 'node:test';
import assert from 'node:assert/strict';
import { memberInProgress, memberState } from '../src/shared/squad-view.ts';

const zh = (_english: string, chinese: string) => chinese;
const none = { approval: false, question: false };

test('a squad member reads the same in the workbench and the card studio', () => {
  assert.deepEqual(memberState({ status: 'running' }, none, zh), { label: '执行中', tone: 'running' });
  assert.deepEqual(memberState({ status: 'queued' }, none, zh), { label: '等待执行', tone: 'queued' });
  assert.deepEqual(memberState({ status: 'completed', workerActive: true }, none, zh), { label: '正在返回结果', tone: 'completed' });
  assert.deepEqual(memberState({ status: 'completed' }, none, zh), { label: '已返回 · 已关闭', tone: 'completed' });
  assert.deepEqual(memberState({ status: 'failed' }, none, zh), { label: '失败 · 已关闭', tone: 'failed' });
  assert.deepEqual(memberState({ status: 'cancelled', workerActive: true }, none, zh), { label: '正在停止', tone: 'cancelled' });
  assert.deepEqual(memberState({ status: 'running' }, { approval: true, question: false }, zh), { label: '等待审批', tone: 'waiting' });
  assert.deepEqual(memberState({ status: 'running' }, { approval: false, question: true }, zh), { label: '等待回应', tone: 'waiting' });
  assert.deepEqual(memberState({ status: 'idle' }, none, zh), { label: '待开始', tone: 'idle' });
  assert.deepEqual([memberInProgress({ status: 'queued' }), memberInProgress({ status: 'completed', workerActive: true }), memberInProgress({ status: 'completed' })], [true, true, false]);
});
