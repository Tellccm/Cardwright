// IPC-only test fixture. It never imports a model provider or makes network requests.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
let init;
/** A worker the harness has to stop the hard way: it never reports done, so nothing of a new session was written. */
let exitOnCancel = false;
/** A member that takes a moment to stop: on cancel it reports after this many milliseconds. */
let lingerOnCancel = 0;
/** linger:<path> — the member's last write lands while it stops, just before it reports. */
let lingerWrite = '';
/** complete-slow-exit: the worker exits a moment after the app lets it go, so its task is still winding down meanwhile. */
let exitDelay = 0;
/** A slow turn keeps running for a moment; follow-up messages that arrive meanwhile are handled before it ends. */
let slow = false;
const followUps = [];
let approval;
let childPrompt = 'complete';
let slotOutcomes = {};
/** A worker stuck mid-request takes no cancel and says no more; 'late' sends one more slot request first, as one already on its way would arrive, and 'late-cooldown' a 429 report. */
let hung = '';
/** rate-slots-open: the run goes on after both slot answers, and the stop reports what the waiting request had been told by then. */
let keepOpen = false;
let turnId;
/** script:[steps] — the lead sends each request in turn and reports every outcome; "@2.1" stands for member 1 of step 2's result.
 *  { method: 'parallel', args: { requests } } sends its requests in one burst, as a model calling several tools together does, and reports their outcomes as one list. */
let script;
function scriptValue(value) {
  if (typeof value === 'string' && /^@\d+\.\d+$/.test(value)) {
    const [step, index] = value.slice(1).split('.').map(Number);
    const result = script.outcomes[step]?.result;
    return (Array.isArray(result?.members) ? result.members[index] : result)?.id;
  }
  if (Array.isArray(value)) return value.map(scriptValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scriptValue(item)]));
  return value;
}
function scriptStep() {
  const step = script.steps[script.outcomes.length];
  if (!step) { const outcomes = script.outcomes; script = undefined; finish(`script:${JSON.stringify(outcomes)}`); return; }
  const at = script.outcomes.length;
  if (step.method === 'parallel') {
    script.burst = { size: step.args.requests.length, outcomes: [] };
    step.args.requests.forEach((request, index) => send({ type: 'request', id: `script-${at}-${index}`, method: request.method, args: scriptValue(request.args) }));
  } else send({ type: 'request', id: `script-${at}`, method: step.method, args: scriptValue(step.args) });
}
const send = message => { if (process.connected) process.send?.(message); };
const event = value => send({ type: 'event', event: { ...value, turnId } });
function reply(text) {
  event({ type: 'message_start', message: { role: 'assistant' } });
  event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });
  event({ type: 'message_end', message: {
    role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop',
    usage: { input: 11, output: 7, cacheRead: 3, cacheWrite: 0, cost: { total: 0 } },
  } });
}
function finish(text = 'Fixture completed.') {
  reply(text);
  send({ type: 'done', sessionFile: `${init.sessionDir}/fixture.jsonl` });
}
/** The model is still writing its first reply: pi holds the user entry in memory and writes the session only at the reply's end. */
function unsaved(messageId) {
  exitOnCancel = true;
  event({ type: 'session_entry', entryId: 'fixture-unsaved-entry', messageId });
  event({ type: 'message_start', message: { role: 'assistant' } });
  event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '正在写……' } });
}
function toolRecord(name, path, failed = false) {
  const id = `${name}-${Math.random()}`;
  event({ type: 'tool_execution_start', toolCallId: id, toolName: name, args: path ? { path: join(init.cwd, ...path.split('/')) } : {} });
  event({ type: 'tool_execution_end', toolCallId: id, result: { content: [{ type: 'text', text: failed ? 'failed' : 'ok' }] }, isError: failed });
}
const CONTINUE_MARKER = '<!-- cardwright:continue -->';
/**
 * 分批写: a dispatch that takes several rounds. `RUN:continue N` ends N work rounds with the continue marker and delivers on
 * the next; `RUN:continue forever` never finishes. `big` reports a full context on a round that goes on; `errors` writes
 * 131-可修 in the first work round and 132-再修 in the second. Every turn is a new worker process, so the state lives in
 * the card folder.
 */
const continueFile = () => join(init.cwd, '.fixture-continue');
function continueState() { return existsSync(continueFile()) ? JSON.parse(readFileSync(continueFile(), 'utf8')) : null; }
/** Whether the dispatch in hand still has rounds to go: a fix round's reply then says so too. */
function moreRounds() { const state = continueState(); return !!state && state.left !== 0; }
function continueRound(command) {
  const start = /RUN:continue (\d+|forever)([^\n]*)/.exec(command);
  let state = continueState();
  if (start && !state) state = { left: start[1] === 'forever' ? -1 : Number(start[1]), round: 0, big: start[2].includes('big'), errors: start[2].includes('errors') };
  if (!state || !(start || command.startsWith('继续做这条派单'))) return false;
  state.round++;
  if (state.errors && state.round === 1) toolRecord('write', '世界书/人设/131-可修.md');
  if (state.errors && state.round === 2) toolRecord('write', '世界书/人设/132-再修.md');
  if (state.left === 0) { rmSync(continueFile(), { force: true }); finish('名单写完了，已交付。'); return true; }
  if (state.left > 0) state.left--;
  writeFileSync(continueFile(), JSON.stringify(state));
  if (state.big) event({ type: 'context_usage', tokens: 150000, window: 200000, percent: 75 });
  finish(`写好了第 ${state.round} 个人物，名单还没写完。\n${CONTINUE_MARKER}`);
  return true;
}
/**
 * RUN:ask forever — a model that never settles: every 全部按推荐 is met with another question. Every turn is a new worker
 * process, so the count of questions asked lives in the card folder, like the state of RUN:continue.
 */
const askFile = () => join(init.cwd, '.fixture-ask');
function askAgain() {
  if (!existsSync(askFile())) return false;
  const asked = Number(readFileSync(askFile(), 'utf8')) + 1;
  writeFileSync(askFile(), String(asked));
  finish(`还有一题（第 ${asked} 题）：称呼用哪个？推荐：大王。\n<!-- cardwright:accept-all -->`);
  return true;
}
/** RUN:interact forever — the same through the question tool, inside one turn: each answer is followed by another question. */
let interactions = 0;
function interact() {
  interactions++;
  send({ type: 'request', id: `interact-${interactions}`, method: 'interaction', args: { type: 'confirm', title: `称呼用大王可以吗？（第 ${interactions} 次）` } });
}
/** One-click making scripts: the dispatch body says what the section AI does. */
function runScript(command) {
  if (command.trim() === '全部按推荐') { if (!askAgain()) finish('已按推荐答复并交付。'); return true; }
  if (command.startsWith('【拼装检查】')) {
    // A fix round of a dispatch that is not finished says so too.
    const fixed = text => finish(moreRounds() ? `${text}\n${CONTINUE_MARKER}` : text);
    if (command.includes('131-可修')) { rmSync(join(init.cwd, '世界书', '人设', '131-可修.json'), { force: true }); toolRecord('write', '世界书/人设/131-可修.md'); fixed('已修正。'); }
    else { toolRecord('write', '世界书/人设/130-坏条目.md'); fixed('已尝试修正。'); }
    return true;
  }
  if (continueRound(command)) return true;
  if (command.includes('RUN:deliver')) finish('已交付。');
  else if (command.includes('RUN:ask forever')) { writeFileSync(askFile(), '1'); finish('称呼用哪个？推荐：大王。\n<!-- cardwright:accept-all -->'); }
  else if (command.includes('RUN:interact forever')) interact();
  else if (command.includes('RUN:ask')) finish('称呼用哪个？推荐：大王。\n<!-- cardwright:accept-all -->');
  else if (command.includes('RUN:refuse')) finish('缺少前置派单，先做人物模板。\n<!-- cardwright:refuse -->');
  else if (command.includes('RUN:incomplete')) finish('人物甲写好了；写人物乙的成员失败，没补齐。\n<!-- cardwright:incomplete -->');
  else if (command.includes('RUN:broken')) { toolRecord('write', '世界书/人设/130-坏条目.md'); finish('已交付。'); }
  else if (command.includes('RUN:fixable')) { toolRecord('write', '世界书/人设/131-可修.md'); finish('已交付。'); }
  // The section AI sends a 写组件 to write the broken component and waits for it, writing nothing itself.
  else if (command.includes('RUN:squad-broken')) send({ type: 'request', id: 'delegate-request', method: 'delegate', args: { role: 'writer', prompt: 'RUN:broken', create: ['坏条目'] } });
  else if (command.includes('RUN:toolfail')) { for (let index = 0; index < 3; index++) toolRecord('powershell', undefined, true); finish('命令一直失败。'); }
  else if (command.includes('RUN:big')) { event({ type: 'context_usage', tokens: 150000, window: 200000, percent: 75 }); finish('已交付。'); }
  else if (command.includes('RUN:hold')) event({ type: 'tool_execution_start', toolCallId: 'holding-tool', toolName: 'fixture_hold', args: {} });
  else if (command.includes('RUN:unsaved')) unsaved(turnId);
  else if (command.includes('RUN:error')) send({ type: 'error', message: '网关返回 502。' });
  else if (command.includes('RUN:approve')) {
    approval = `${init.taskId}-approve`;
    event({ type: 'tool_execution_start', toolCallId: 'approval-tool', toolName: 'write', args: { path: 'fixture.txt' } });
    send({ type: 'request', id: approval, method: 'approve', args: { toolName: 'write', args: { path: 'fixture.txt' }, reason: 'Fixture approval.' } });
  } else if (command.includes('RUN:slow')) {
    slow = true;
    setTimeout(() => {
      reply('已交付。');
      for (const next of followUps.splice(0)) { turnId = next.messageId; event({ type: 'message_start', messageId: next.messageId, message: { role: 'user' } }); reply(`Echo: ${next.text}`); }
      slow = false;
      send({ type: 'done', sessionFile: `${init.sessionDir}/fixture.jsonl` });
    }, 700);
  } else return false;
  return true;
}
process.on('message', message => {
  if (message.type === 'init') {
    init = message;
    // As the real worker (src/runtime/conversation-history.ts): a cursor must point into the saved session file.
    if (typeof init.sessionLeafId === 'string' && !(init.sessionFile && existsSync(init.sessionFile) && readFileSync(init.sessionFile, 'utf8').includes(`"id":"${init.sessionLeafId}"`))) {
      send({ type: 'error', message: 'The selected conversation version is missing a saved entry.' });
      return;
    }
    send({ type: 'ready', sessionFile: init.sessionFile ?? `${init.sessionDir}/fixture.jsonl` });
  } else if (message.type === 'cancel') {
    if (hung) {
      if (hung === 'late') send({ type: 'request', id: 'hung-late', method: 'rate-slot', args: {} });
      if (hung === 'late-cooldown') send({ type: 'request', id: 'hung-cooldown', method: 'rate-cooldown', args: { seconds: 3 } });
      return;
    }
    if (keepOpen) event({ type: 'workflow_notice', message: `slot-2 at the stop: ${slotOutcomes['slot-2'] ?? 'unanswered'}` });
    if (exitOnCancel) process.exit(0);
    if (lingerOnCancel) {
      setTimeout(() => {
        if (lingerWrite) { writeFileSync(join(init.cwd, ...lingerWrite.split('/')), '成员停下前写的\n'); toolRecord('write', lingerWrite); }
        event({ type: 'run_cancelled' }); send({ type: 'done' });
      }, lingerOnCancel);
      return;
    }
    event({ type: 'run_cancelled' });
    send({ type: 'done' });
  } else if (message.type === 'prompt') {
    if (slow) { followUps.push(message); return; }
    turnId = message.messageId;
    event({ type: 'message_start', messageId: message.messageId, message: { role: 'user' } });
    const command = message.text;
    if (runScript(command)) return;
    if (command === 'complete' || command === 'release') finish();
    else if (command === 'complete-slow-exit') { exitDelay = 400; finish(); }
    else if (command === 'effective-thinking') { event({ type: 'thinking_level_changed', level: 'off' }); finish(); }
    else if (command === 'truncate') {
      // Mirrors the real worker: reasoning-only length stop, then output_truncated, error and done.
      event({ type: 'message_start', message: { role: 'assistant' } });
      event({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Planning the SVG geometry…' } });
      event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Planning the SVG geometry…' }], stopReason: 'length', usage: { input: 20, output: 1024, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } });
      event({ type: 'output_truncated', outputTokens: 1024, maxTokens: 1024, model: 'fixture' });
      send({ type: 'error', message: 'Output limit reached (1,024 / 1,024 tokens). The truncated response wrote no files.' });
      send({ type: 'done', sessionFile: `${init.sessionDir}/fixture.jsonl` });
    }
    else if (command === 'hold') {
      event({ type: 'tool_execution_start', toolCallId: 'holding-tool', toolName: 'fixture_hold', args: {} });
    } else if (command.startsWith('write:')) {
      // A member that writes one component and returns (a lead's script can name it: it holds no RUN: word).
      toolRecord('write', command.slice('write:'.length)); finish('写好了。');
    } else if (command.startsWith('put:')) {
      // The same, but the file really changes on disk, so the lead's checkpoint sees it.
      const path = command.slice('put:'.length);
      writeFileSync(join(init.cwd, ...path.split('/')), '成员写的\n'); toolRecord('write', path); finish('写好了。');
    } else if (command === 'linger' || command.startsWith('linger:')) {
      lingerOnCancel = 500;
      lingerWrite = command.slice('linger:'.length);
      event({ type: 'tool_execution_start', toolCallId: 'holding-tool', toolName: 'fixture_hold', args: {} });
    } else if (command === 'unsaved') unsaved(message.messageId);
    else if (command === 'error') {
      event({ type: 'tool_execution_start', toolCallId: 'failing-tool', toolName: 'fixture_error', args: {} });
      send({ type: 'error', message: `Fixture failed: ${init.apiKey}` });
    } else if (command === 'crash') {
      process.stderr.write(`Fixture crashed: ${init.apiKey}`);
      process.exit(3);
    } else if (command === 'approve') {
      approval = `${init.taskId}-approve`;
      event({ type: 'tool_execution_start', toolCallId: 'approval-tool', toolName: 'write', args: { path: 'fixture.txt' } });
      send({ type: 'request', id: approval, method: 'approve', args: { toolName: 'write', args: { path: 'fixture.txt' }, reason: 'Fixture approval.' } });
    } else if (command === 'inspect-card-init') {
      finish(JSON.stringify({ canDelegate: init.canDelegate, memoryEnabled: init.ecosystem?.memoryEnabled, searchEnabled: init.search?.enabled, role: init.roleDefinition?.id, readOnly: !!(init.readOnly || init.roleDefinition?.readOnly), permission: init.permission, thinking: init.thinking, modelId: init.gateway?.modelId, prompt: init.card?.prompt ?? '', readRoots: init.card?.readRoots ?? [], member: init.card?.member ?? null, roles: (init.roles ?? []).map(role => role.id), mcpServers: (init.mcpServers ?? []).length, fileCheckpoints: !!init.fileCheckpoints, addDispatches: init.card?.addDispatches === true }));
    } else if (command === 'reply-dispatches') {
      finish(['设计书已写入。', '```派单\n目标: 世界书/叙事规则\n标题: 写叙事规则\n前置: 设计书已确认\n---\n写四条叙事规则。\n```', '```派单\n目标: 世界书/人设\n标题: 写人物模板\n前置: 设计书已确认\n---\n量身定做人物模板。\n```'].join('\n\n'));
    } else if (command.includes('CHANGE:impact')) {
      // The change AI's 影响清单, in no particular order and with the title prefix written three ways; each body is a run script.
      const block = (target, title, body) => '```派单\n目标: ' + target + '\n标题: ' + title + '\n前置: \n---\n' + body + '\n```';
      finish(['创角页要多一个自定义开局选项，牵涉四个组件。', block('开场白', '改动 · 开场白提到自定义开局', 'RUN:deliver 开场白'), block('正则/开局创角页', '加自定义选项', 'RUN:deliver 创角页'), block('脚本/变量结构', '改动 · 变量表加开局字段', 'RUN:deliver 变量表'), block('世界书/变量', '改动·变量规则', 'RUN:deliver 变量规则')].join('\n\n'));
    } else if (command.includes('CHANGE:direct')) {
      toolRecord('edit', '正则/创角页.json');
      finish('只动了创角页这一个组件，已直接改好。');
    } else if (command.includes('CHANGE:squad')) {
      // The change AI sends a 写组件 to edit the one component and waits for it.
      send({ type: 'request', id: 'delegate-request', method: 'delegate', args: { role: 'writer', prompt: 'write:正则/创角页.json', create: ['创角页'] } });
    } else if (command.startsWith('card-request:')) {
      event({ type: 'tool_execution_start', toolCallId: 'card-tool', toolName: 'card_tool', args: {} });
      send({ type: 'request', id: 'card-request', method: 'card', args: JSON.parse(command.slice('card-request:'.length)) });
    } else if (command.startsWith('【换对话 · 请写交接摘要】')) {
      finish(['好的，下面是交接摘要。', '```交接摘要', '已定: 人物模板 v2', '已写: 红孩儿 uid 120', '未完成: 名单剩余 19 人', '第一步: 写黄袍怪', '```'].join('\n'));
    } else if (command === 'inspect-init') {
      finish(JSON.stringify({ role: init.roleDefinition?.id, readOnly: !!(init.readOnly || init.roleDefinition?.readOnly), rolePrompt: init.roleDefinition?.prompt ?? null, planMode: !!init.planMode, sharedWorkspace: !!init.sharedWorkspace, cwd: init.cwd, roles: (init.roles ?? []).map(role => role.id), squadSize: init.squadSize }));
    } else if (command === 'inspect-identity') {
      finish(JSON.stringify(init.identity ?? null));
    } else if (command.startsWith('team:')) {
      event({ type: 'tool_execution_start', toolCallId: 'team-tool', toolName: 'agent_team', args: {} });
      send({ type: 'request', id: 'team-request', method: 'team', args: { members: [{ name: '甲队员', prompt: command.slice(5) }, { name: '乙队员', prompt: command.slice(5) }] } });
    } else if (command.startsWith('delegate-role:')) {
      childPrompt = 'complete';
      event({ type: 'tool_execution_start', toolCallId: 'delegating-tool', toolName: 'delegate_task', args: {} });
      send({ type: 'request', id: 'delegate-request', method: 'delegate', args: { title: 'Fixture child', prompt: childPrompt, role: command.slice('delegate-role:'.length) } });
    } else if (command === 'delegate' || command === 'delegate-hold') {
      childPrompt = command === 'delegate-hold' ? 'hold' : 'complete';
      event({ type: 'tool_execution_start', toolCallId: 'delegating-tool', toolName: 'delegate_task', args: {} });
      send({ type: 'request', id: 'delegate-request', method: 'delegate', args: { title: 'Fixture child', prompt: childPrompt } });
    } else if (command === 'inspect-gateway') {
      finish(JSON.stringify({ rateSlots: init.rateSlots, retry: init.gateway?.retry, stall: init.gateway?.stall }));
    } else if (command === 'rate-slots' || command === 'rate-slots-open') {
      // Two model requests back to back, each asking the desktop process for a rate slot first, as the real worker's hook does.
      // The open variant does not finish when both are answered, so a test can look at the task while it still runs.
      slotOutcomes = {};
      keepOpen = command === 'rate-slots-open';
      for (const id of ['slot-1', 'slot-2']) send({ type: 'request', id, method: 'rate-slot', args: {} });
    } else if (command === 'rate-slots-hung' || command === 'rate-slots-late') {
      // The same two requests from a worker that then hangs: it never says done, so the desktop process has to give the
      // waits up on its own. Its requests have their own ids, so nothing it is answered with ends the run.
      hung = command === 'rate-slots-late' ? 'late' : 'silent';
      for (const id of ['hung-1', 'hung-2']) send({ type: 'request', id, method: 'rate-slot', args: {} });
    } else if (command === 'cooldown-late') {
      // A worker stuck on its last request, which meets a 429 just as the stop reaches it: the report is on its way when the
      // task is already stopping, and the worker never says done.
      hung = 'late-cooldown';
      event({ type: 'workflow_notice', message: 'waiting for the stop' });
    } else if (command === 'cooldown-retry') {
      // A 429 as the real worker reports it: the cooldown first, then pi's error reply and its retry announcement;
      // after pi's backoff the retried request asks for its slot.
      send({ type: 'request', id: 'cooldown-report', method: 'rate-cooldown', args: { seconds: 3 } });
      event({ type: 'message_start', message: { role: 'assistant' } });
      event({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '429: Too many requests' } });
      event({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 2000, errorMessage: '429: Too many requests' });
      setTimeout(() => send({ type: 'request', id: 'retry-slot', method: 'rate-slot', args: {} }), 2000);
    } else if (command === 'auto-retry') {
      // pi after a failed request: the retry is announced, the backoff passes, the retried reply streams, the run ends.
      event({ type: 'auto_retry_start', attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: '上游服务繁忙' });
      setTimeout(() => reply('重试后完成。'), 400);
      setTimeout(() => send({ type: 'done', sessionFile: `${init.sessionDir}/fixture.jsonl` }), 800);
    } else if (command === 'compaction-retry') {
      event({ type: 'summarization_retry_scheduled', attempt: 1, maxAttempts: 2, delayMs: 2000, errorMessage: 'fetch failed' });
      setTimeout(() => event({ type: 'summarization_retry_attempt_start', source: 'compaction', reason: 'threshold' }), 400);
      setTimeout(() => finish('压缩后完成。'), 800);
    } else if (command.startsWith('script:')) {
      script = { steps: JSON.parse(command.slice('script:'.length)), outcomes: [] };
      scriptStep();
    } else finish(`Echo: ${command}`);
  } else if (message.type === 'response') {
    if (script && message.id === `script-${script.outcomes.length}`) {
      script.outcomes.push(message.error ? { error: message.error } : { ok: true, result: message.result });
      scriptStep();
    } else if (script?.burst && message.id.startsWith(`script-${script.outcomes.length}-`)) {
      script.burst.outcomes[Number(message.id.split('-').at(-1))] = message.error ? { error: message.error } : { ok: true, result: message.result };
      if (script.burst.outcomes.filter(Boolean).length === script.burst.size) {
        script.outcomes.push({ ok: true, result: script.burst.outcomes });
        script.burst = undefined;
        scriptStep();
      }
    } else if (typeof message.id === 'string' && message.id.startsWith('interact-')) {
      interact();
    } else if (message.id === approval) {
      event({ type: 'tool_execution_end', toolCallId: 'approval-tool', result: { content: [{ type: 'text', text: String(message.result) }] }, isError: message.result !== true });
      finish(`approval:${typeof message.result}:${String(message.result)}`);
    } else if (message.id === 'delegate-request') {
      if (message.error) finish(`delegate-error:${message.error}`);
      else send({ type: 'request', id: 'wait-request', method: 'wait', args: { taskIds: [message.result.id] } });
    } else if (message.id === 'team-request') {
      if (message.error) finish(`team-error:${message.error}`);
      else send({ type: 'request', id: 'wait-request', method: 'wait', args: { taskIds: message.result.members.map(member => member.id) } });
    } else if (message.id === 'card-request') {
      if (message.error) finish(`card-error:${message.error}`);
      else finish(`card:${JSON.stringify(message.result)}`);
    } else if (message.id === 'slot-1' || message.id === 'slot-2') {
      slotOutcomes[message.id] = message.error ? `refused: ${message.error}` : 'granted';
      if (Object.keys(slotOutcomes).length === 2) {
        if (keepOpen) event({ type: 'workflow_notice', message: `slots answered:${JSON.stringify(slotOutcomes)}` });
        else finish(`slots:${JSON.stringify(slotOutcomes)}`);
      }
    } else if (message.id === 'hung-cooldown') {
      event({ type: 'workflow_notice', message: 'late cooldown answered' });
    } else if (message.id === 'hung-late') {
      // The one answer a hung worker passes on, so a test can see how the desktop process treated the late request.
      event({ type: 'workflow_notice', message: `late slot ${message.error ? `refused: ${message.error}` : 'granted'}` });
    } else if (message.id === 'retry-slot') {
      finish(message.error ? `retry-refused:${message.error}` : '重试后完成。');
    } else if (message.id === 'wait-request') finish(`children:${JSON.stringify(message.result)}`);
  } else if (message.type === 'search') {
    // What the desktop process told this worker about web search, so a test can read it in the conversation.
    event({ type: 'workflow_notice', message: `search:${message.search?.enabled}` });
  }
});
process.on('disconnect', () => { if (exitDelay) setTimeout(() => process.exit(0), exitDelay); else process.exit(0); });
