import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, transcriptFileName } from '../src/shared/transcript.ts';
import type { Task } from '../src/shared/types.ts';

const task = {
  title: 'Fix the gateway', cwd: 'E:/work/app', modelId: 'test-model',
  createdAt: '2026-09-20T09:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z',
  messages: [
    { id: 'm1', role: 'user' as const, text: 'Please fix the 400.', at: '2026-09-20T09:00:00.000Z', turnId: 'turn-1' },
    { id: 'm2', role: 'assistant' as const, text: 'Found it: an unsupported field.', thinking: 'The relay hides the body.', at: '2026-09-20T09:01:00.000Z', turnId: 'turn-1', usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } },
    { id: 'm3', role: 'user' as const, text: 'Ship it.', at: '2026-09-20T09:30:00.000Z', turnId: 'turn-2' },
    { id: 'm4', role: 'assistant' as const, text: 'Done.', at: '2026-09-20T09:31:00.000Z', turnId: 'turn-2' },
  ],
  tools: [
    { id: 't1', name: 'read', args: { path: 'src/worker.ts' }, output: 'file contents', status: 'completed' as const, at: '2026-09-20T09:00:30.000Z', turnId: 'turn-1' },
    { id: 't2', name: 'edit', args: { path: 'src/worker.ts' }, output: '', patch: '--- a\n+++ b\n', status: 'completed' as const, at: '2026-09-20T09:00:45.000Z', turnId: 'turn-1' },
  ],
  chapters: [{ id: 'c1', title: 'Diagnosis', turnId: 'turn-1', at: '2026-09-20T09:00:00.000Z' }],
} as unknown as Task;

test('a transcript keeps the conversation, its thinking, its tools and its chapters, in order', () => {
  const markdown = buildTranscript(task, { chapters: task.chapters, projectName: 'App', gatewayName: 'Local relay' });
  assert.match(markdown, /^# Fix the gateway/);
  assert.match(markdown, /\| Project \| App \|/);
  assert.match(markdown, /\| Model \| test-model \(Local relay\) \|/);
  assert.match(markdown, /\| Reported tokens \| 120 \|/);
  assert.match(markdown, /## Diagnosis/);
  assert.ok(markdown.includes('Please fix the 400.'));
  assert.ok(markdown.includes('The relay hides the body.'), 'thinking is kept, folded away');
  assert.ok(markdown.includes('<summary>Thinking</summary>'));
  assert.ok(markdown.includes('<strong>read</strong>'));
  assert.ok(markdown.includes('--- a'), 'a patch travels with its tool call');
  // Order is the conversation's own.
  assert.ok(markdown.indexOf('Please fix the 400.') < markdown.indexOf('Found it'));
  assert.ok(markdown.indexOf('Found it') < markdown.indexOf('Ship it.'));
});

test('a fenced block inside a message cannot break out of its own fence', () => {
  const tricky = { ...task, messages: [{ id: 'm1', role: 'assistant' as const, text: 'x', thinking: '```\nconst a = 1;\n```', at: '2026-09-20T09:00:00.000Z' }], tools: [], chapters: [] } as unknown as Task;
  const markdown = buildTranscript(tricky);
  // The wrapper must be longer than the longest fence inside it.
  const wrapper = markdown.match(/`{4,}/);
  assert.ok(wrapper, 'a body containing a fence is wrapped in a longer one');
});

test('a very long tool result is clipped rather than making the file unopenable', () => {
  const huge = { ...task, chapters: [], messages: [{ id: 'm1', role: 'assistant' as const, text: 'ok', at: '2026-09-20T09:00:00.000Z', turnId: 'turn-1' }],
    tools: [{ id: 't1', name: 'bash', args: {}, output: 'y'.repeat(60_000), status: 'completed' as const, at: '2026-09-20T09:00:00.000Z', turnId: 'turn-1' }] } as unknown as Task;
  const markdown = buildTranscript(huge);
  assert.ok(markdown.length < 40_000);
  assert.match(markdown, /more characters/);
});

test('tool calls with no visible message of their own are still recorded', () => {
  const orphan = { ...task, chapters: [], messages: [], tools: [{ id: 't1', name: 'bash', args: {}, output: 'ran', status: 'completed' as const, at: '2026-09-20T09:00:00.000Z', turnId: 'gone' }] } as unknown as Task;
  assert.ok(buildTranscript(orphan).includes('<strong>bash</strong>'));
});

test('the suggested file name is one Windows accepts', () => {
  const at = new Date('2026-09-29T12:00:00');
  assert.equal(transcriptFileName('Fix: the a/b <gateway>?', at), 'Fix the a b gateway 20260929.md');
  assert.equal(transcriptFileName('', at), 'Conversation 20260929.md');
  assert.ok(!/[\\/:*?"<>|]/.test(transcriptFileName('a:b*c?d"e<f>g|h/i\\j', at).replace('.md', '')));
  assert.ok(transcriptFileName('x'.repeat(200), at).length < 80);
});
