import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUE_TEXT, RUN_PAUSE_LABELS, carriedOn, dispatchErrors, runQueue, runUsage, toolFailureStreak, turnOutcome } from '../src/shared/card-studio/run.ts';
import { ACCEPT_ALL_MARKER, CONTINUE_MARKER, INCOMPLETE_MARKER, REFUSE_MARKER } from '../src/shared/card-studio/markers.ts';
import { squadTools } from '../src/shared/card-studio/view.ts';
import type { CardCheckReport, CardDispatch, CardRun } from '../src/shared/card-studio/types.ts';
import type { ChatMessage, Task, ToolCall } from '../src/shared/types.ts';

const dispatch = (id: string, sectionId: string | null, status: CardDispatch['status'] = 'todo'): CardDispatch => ({ id, target: '', sectionId, title: id, requires: '', body: '', status, createdAt: '', updatedAt: '' });
const at = '2026-09-19T10:00:00.000Z';
const user = (id: string, text = '派单'): ChatMessage => ({ id, role: 'user', text, at, turnId: id });
const ai = (id: string, text: string, turnId: string, usage?: ChatMessage['usage']): ChatMessage => ({ id, role: 'assistant', text, at, turnId, ...(usage ? { usage } : {}) });
const tool = (name: string, status: ToolCall['status'], turnId: string, path?: string): ToolCall => ({ id: `${name}-${Math.random()}`, name, args: path ? { path } : {}, output: '', status, at, turnId });

// 进行中 ones too: a run that was stopped or paused for good leaves its dispatch there, and the next run picks it up where it stopped.
test('the queue takes the unsent and the 进行中 dispatches of the chosen boards, in planning order', () => {
  const dispatches = [dispatch('p', 'plan'), dispatch('a', 'lore-people'), dispatch('b', 'regex-body'), dispatch('c', 'lore-rules', 'done'), dispatch('d', 'script-schema'), dispatch('e', 'greet'), dispatch('f', 'build'), dispatch('g', null), dispatch('h', 'lore-plot', 'active'), dispatch('i', 'source'), dispatch('j', 'regex-status', 'active'), { ...dispatch('k', 'lore-setting', 'active'), changeId: 'change-1' }];
  assert.deepEqual(runQueue(dispatches, 'all'), ['a', 'b', 'd', 'e', 'h', 'j']);
  assert.deepEqual(runQueue(dispatches, 'lore'), ['a', 'h']);
  assert.deepEqual(runQueue(dispatches, 'regex'), ['b', 'j']);
  assert.deepEqual(runQueue(dispatches, 'greet'), ['e']);
  assert.deepEqual(runQueue([dispatch('x', 'lore-people', 'done'), dispatch('y', 'lore-people', 'active')], 'lore'), ['y'], 'only 进行中 is left, and it is enough to start');
});

test('a dispatch aimed at a section no board has stays out of the queue instead of throwing', () => {
  const dispatches = [dispatch('a', 'lore-people'), dispatch('x', 'lore-other'), dispatch('y', '随便什么'), dispatch('b', 'greet')];
  assert.deepEqual(runQueue(dispatches, 'all'), ['a', 'b']);
  assert.deepEqual(runQueue(dispatches, 'lore'), ['a']);
});

test('three failures in a row of the same tool count; a success or another tool breaks the streak', () => {
  assert.deepEqual(toolFailureStreak([tool('powershell', 'failed', 't'), tool('powershell', 'failed', 't'), tool('powershell', 'failed', 't')]), { name: 'powershell', count: 3 });
  assert.equal(toolFailureStreak([tool('powershell', 'failed', 't'), tool('read', 'failed', 't'), tool('powershell', 'failed', 't'), tool('powershell', 'failed', 't')]), null);
  assert.equal(toolFailureStreak([tool('write', 'failed', 't'), tool('write', 'completed', 't'), tool('write', 'failed', 't'), tool('write', 'failed', 't')]), null);
});

test('a turn is a model error, an interjection, a question, a refusal or a delivery', () => {
  const base = { status: 'completed' as Task['status'], tools: [] as ToolCall[], sent: ['u1'] };
  assert.equal(turnOutcome({ ...base, messages: [user('u1'), ai('a1', '已交付。', 'u1')] }).kind, 'delivered');
  assert.deepEqual(turnOutcome({ ...base, status: 'failed', error: '网关 502', messages: [user('u1')] }), { kind: 'model-error', message: '网关 502' });
  assert.equal(turnOutcome({ ...base, status: 'cancelled', messages: [user('u1')] }).kind, 'cancelled');
  assert.equal(turnOutcome({ ...base, messages: [user('u1'), ai('a1', '好', 'u1'), user('x', '顺便改一下语气'), ai('a2', '已改。', 'x')] }).kind, 'interjection');
  const question = turnOutcome({ ...base, messages: [user('u1'), ai('a1', `1. 用哪个称呼？推荐：大王。\n${ACCEPT_ALL_MARKER}`, 'u1')] });
  assert.equal(question.kind, 'question');
  assert.ok(question.kind === 'question' && question.text.includes('用哪个称呼') && !question.text.includes(ACCEPT_ALL_MARKER));
  assert.equal(turnOutcome({ ...base, messages: [user('u1'), ai('a1', `缺少设计书。\n${REFUSE_MARKER}`, 'u1')] }).kind, 'refusal');
  // A marker quoted in a code block (a regex or prompt the section wrote) is not the AI speaking.
  assert.equal(turnOutcome({ ...base, messages: [user('u1'), ai('a1', `已交付。\n\`\`\`html\n${REFUSE_MARKER}\n\`\`\``, 'u1')] }).kind, 'delivered');
  const failing = [tool('powershell', 'failed', 'u1'), tool('powershell', 'failed', 'u1'), tool('powershell', 'failed', 'u1')];
  assert.deepEqual(turnOutcome({ ...base, tools: failing, messages: [user('u1'), ai('a1', '命令一直失败。', 'u1')] }), { kind: 'tool-failures', tool: 'powershell', count: 3 });
  // Earlier turns of the same conversation do not count.
  assert.equal(turnOutcome({ ...base, sent: ['u2'], messages: [user('u1'), ai('a1', `问题？\n${ACCEPT_ALL_MARKER}`, 'u1'), user('u2'), ai('a2', '已交付。', 'u2')] }).kind, 'delivered');
  // A message the user slipped in between two dispatches is an interjection, even though it is before this dispatch.
  const between = [user('u1'), ai('a1', '已交付。', 'u1'), user('x', '补充：先等一下'), ai('ax', '好的。', 'x'), user('u2'), ai('a2', '已交付。', 'u2')];
  assert.equal(turnOutcome({ ...base, sent: ['u2'], known: ['u1', 'u2'], messages: between }).kind, 'interjection');
  assert.equal(turnOutcome({ ...base, sent: ['u2'], known: ['u1', 'x', 'u2'], messages: between }).kind, 'delivered', 'once it is acknowledged the run goes on');
});

test('a turn that names the squad’s gaps is incomplete; the markers rank refusal, question, incomplete', () => {
  const base = { status: 'completed' as Task['status'], tools: [] as ToolCall[], sent: ['u1'] };
  const reply = (text: string) => turnOutcome({ ...base, messages: [user('u1'), ai('a1', text, 'u1')] });
  const incomplete = reply(`人物乙没写成。\n${INCOMPLETE_MARKER}`);
  assert.deepEqual(incomplete, { kind: 'incomplete', text: '人物乙没写成。' });
  assert.equal(reply(`缺口。\n${INCOMPLETE_MARKER}\n要哪个？\n${ACCEPT_ALL_MARKER}`).kind, 'question');
  assert.equal(reply(`做不了。\n${REFUSE_MARKER}\n要哪个？\n${ACCEPT_ALL_MARKER}`).kind, 'refusal', 'spec §5.3: a refusal outranks a question');
  assert.equal(RUN_PAUSE_LABELS.incomplete.zh, '小队留下了缺口');
});

// §5.3: refusal > question > incomplete > continue > delivered.
test('the reply markers rank refusal, question, incomplete, continue, delivery', () => {
  const base = { status: 'completed' as Task['status'], tools: [] as ToolCall[], sent: ['u1'] };
  const incomplete = '<!-- cardwright:incomplete -->';
  const outcome = (...markers: string[]) => turnOutcome({ ...base, messages: [user('u1'), ai('a1', ['写好了一个人物。', ...markers].join('\n'), 'u1')] }).kind;
  assert.equal(outcome(), 'delivered');
  assert.equal(outcome(CONTINUE_MARKER), 'continue');
  assert.equal(outcome(incomplete, CONTINUE_MARKER), 'incomplete');
  assert.equal(outcome(ACCEPT_ALL_MARKER, incomplete, CONTINUE_MARKER), 'question');
  assert.equal(outcome(REFUSE_MARKER, ACCEPT_ALL_MARKER, incomplete, CONTINUE_MARKER), 'refusal');
  // Only the last reply of the dispatch counts: an earlier round that went on does not make a finished round go on.
  const rounds = [user('u1'), ai('a1', `写好了第一个。\n${CONTINUE_MARKER}`, 'u1'), user('u2', CONTINUE_TEXT), ai('a2', '名单写完了。', 'u2')];
  assert.equal(turnOutcome({ ...base, sent: ['u1', 'u2'], messages: rounds }).kind, 'delivered');
});

// 分批写: one dispatch spans many rounds, so an old streak must not stop every round after it.
test('a failing streak counts only in the round that just ended', () => {
  const failing = (turnId: string) => [tool('powershell', 'failed', turnId), tool('powershell', 'failed', turnId), tool('powershell', 'failed', turnId)];
  const messages = [user('u1'), ai('a1', '命令一直失败。', 'u1'), user('u2', CONTINUE_TEXT), ai('a2', `写好了第二个人物。\n${CONTINUE_MARKER}`, 'u2')];
  const base = { status: 'completed' as Task['status'], sent: ['u1', 'u2'], messages };
  assert.equal(turnOutcome({ ...base, tools: failing('u1') }).kind, 'continue', '继续 after a tool-failures pause gets past the old streak');
  assert.deepEqual(turnOutcome({ ...base, tools: failing('u2') }), { kind: 'tool-failures', tool: 'powershell', count: 3 });
});

test('a dispatch the run carries on with is still the run\'s to send though it is 进行中', () => {
  const run = { continued: { dispatchId: 'a', count: 3 } };
  assert.equal(carriedOn(run, { id: 'a', status: 'active' }), true);
  assert.equal(carriedOn(run, { id: 'a', status: 'done' }), false);
  assert.equal(carriedOn(run, { id: 'b', status: 'active' }), false);
  assert.equal(carriedOn({}, { id: 'a', status: 'active' }), false);
  // So is one an earlier run left 进行中 and this run picked up when it started; one the user started by hand meanwhile is not.
  const picked = { pickedUp: ['a'] };
  assert.equal(carriedOn(picked, { id: 'a', status: 'active' }), true);
  assert.equal(carriedOn(picked, { id: 'a', status: 'done' }), false);
  assert.equal(carriedOn(picked, { id: 'b', status: 'active' }), false);
});

test('only check errors on the components this dispatch wrote hold it back', () => {
  const report: CardCheckReport = { ok: false, checkedAt: at, stats: { entries: 0, constantChars: 0, constantTokens: 0, sections: {} }, findings: [
    { level: 'error', code: 'a', message: '人设参数缺失', path: '世界书/人设/120-红孩儿.json' },
    { level: 'error', code: 'b', message: '别的分区的错误', path: '世界书/剧情/200-火云洞.md' },
    { level: 'warning', code: 'c', message: '只是警告', path: '世界书/人设/120-红孩儿.md' },
  ] };
  const tools = [tool('write', 'completed', 'u1', 'E:/Cards/西游/世界书/人设/120-红孩儿.md'), tool('write', 'completed', 'other', 'E:/Cards/西游/世界书/剧情/200-火云洞.md')];
  assert.deepEqual(dispatchErrors(report, tools, ['u1'], 'E:/Cards/西游').map(finding => finding.code), ['a']);
  assert.deepEqual(dispatchErrors(report, [], ['u1'], 'E:/Cards/西游'), []);
});

test('check errors on components a squad member wrote during the dispatch hold it back too', () => {
  const report: CardCheckReport = { ok: false, checkedAt: at, stats: { entries: 0, constantChars: 0, constantTokens: 0, sections: {} }, findings: [
    { level: 'error', code: 'member', message: '黄袍怪参数缺失', path: '世界书/人设/130-黄袍怪.json' },
  ] };
  const lead = { messages: [user('u1'), ai('a1', '已交付。', 'u1')] };
  const member = { id: 'm1', projectId: 'p', title: '写组件 · 白骨精', cwd: 'E:/Cards/西游', status: 'completed', permission: 'edit', gatewayId: 'g', thinking: 'off', createdAt: '2026-09-19T10:00:30.000Z', updatedAt: at, messages: [], parentId: 'lead', agentName: '白骨精',
    card: { sectionId: 'lore-people', member: true, squad: { role: 'writer', files: [], create: ['黄袍怪'] } },
    tools: [{ ...tool('write', 'completed', 'member-turn', 'E:/Cards/西游/世界书/人设/130-黄袍怪.md'), at: '2026-09-19T10:01:00.000Z' }] } as Task;
  assert.deepEqual(dispatchErrors(report, [], ['u1'], 'E:/Cards/西游'), [], 'the lead itself wrote nothing');
  assert.deepEqual(dispatchErrors(report, squadTools(lead, [member], ['u1']), ['u1'], 'E:/Cards/西游').map(finding => finding.code), ['member']);
});

test('a run adds up the usage of its conversations since it started', () => {
  const run = { conversations: { 'lore-people': 't1' }, current: { taskId: 't2' }, startedAt: '2026-09-19T09:00:00.000Z' } as unknown as CardRun;
  const usage = { input: 100, output: 20, cacheRead: 50, cacheWrite: 0, cost: 0.01 };
  const early = { ...ai('old', 'x', 'u0', usage), at: '2026-09-19T08:00:00.000Z' };
  const tasks = [
    { id: 't1', messages: [early, ai('a', 'x', 'u1', usage)] },
    { id: 't2', messages: [ai('b', 'x', 'u2', usage)] },
    { id: 'other', messages: [ai('c', 'x', 'u3', usage)] },
  ] as unknown as Task[];
  const total = runUsage(run, tasks);
  assert.equal(total.tokens, 340);
  assert.ok(Math.abs(total.cost - 0.02) < 1e-9);
});
