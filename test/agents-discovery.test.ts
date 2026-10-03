import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgents } from '../src/core/agents.ts';
import { answersAsPlanner, findRole, mergeAgents, readsOnly, replacesReadOnlyBuiltIn, roleDescription, roleLabel, roleSummaries, roleUnavailable, usableAgents, type DiscoveredAgent } from '../src/shared/agents.ts';
import type { AgentRole } from '../src/shared/types.ts';

const NL = String.fromCharCode(10);
const agentFile = (name: string, description: string, extra: string[], body: string) =>
  ['---', `name: ${name}`, `description: ${description}`, ...extra, '---', '', body, ''].join(NL);

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'cardwright-agents-'));
  const home = join(root, 'home'); const project = join(root, 'project');
  await mkdir(join(home, '.claude', 'agents'), { recursive: true });
  await mkdir(join(project, '.claude', 'agents'), { recursive: true });
  return { root, home, project };
}

const builtIn = (id: string, name: string, readOnly: boolean): AgentRole => ({ id, name, prompt: `${name}的指令。`, readOnly, builtIn: true });
const fileAgent = (source: 'project' | 'user', name: string, extra: Partial<DiscoveredAgent> = {}): DiscoveredAgent => ({
  id: source === 'project' ? `agent:project:p1:${name}` : `agent:user:${name}`, name, description: `${name} 的说明`, prompt: `${name} 的正文。`,
  readOnly: false, source, path: `${source}/${name}.md`, ...(source === 'project' ? { projectId: 'p1' } : {}), ...extra,
});

test('reads the Claude Code agent format and skips what it cannot use', async () => {
  const { root, home, project } = await workspace();
  try {
    await writeFile(join(home, '.claude', 'agents', 'reviewer.md'), agentFile('reviewer', '审查改动，不写文件', ['tools: Read, Grep, Glob'], '你是审查者。只读，不改文件。'));
    await writeFile(join(home, '.claude', 'agents', 'builder.md'), agentFile('builder', '实现功能', ['tools: Read, Write, Bash', 'model: sonnet'], '你负责实现。'));
    await writeFile(join(home, '.claude', 'agents', 'no-frontmatter.md'), '这个文件没有 frontmatter。' + NL);
    await writeFile(join(home, '.claude', 'agents', 'nameless.md'), ['---', 'description: 缺少名字', '---', '正文'].join(NL));
    await writeFile(join(home, '.claude', 'agents', 'empty-body.md'), agentFile('empty', '正文是空的', [], '   '));
    await writeFile(join(project, '.claude', 'agents', 'planner.md'), agentFile('planner', '先出计划', [], '你先写计划。'));
    const found = discoverAgents({ projects: [{ id: 'p1', path: project }], homeDir: home });
    assert.deepEqual(found.map(agent => agent.name).sort(), ['builder', 'planner', 'reviewer']);
    const reviewer = found.find(agent => agent.name === 'reviewer')!;
    assert.equal(reviewer.readOnly, true, 'no writing tool means a read-only subagent');
    assert.equal(reviewer.source, 'user');
    assert.deepEqual(reviewer.tools, ['Read', 'Grep', 'Glob']);
    assert.match(reviewer.prompt, /只读/);
    const builder = found.find(agent => agent.name === 'builder')!;
    assert.equal(builder.readOnly, false);
    assert.equal(builder.model, 'sonnet');
    const planner = found.find(agent => agent.name === 'planner')!;
    assert.equal(planner.source, 'project');
    assert.equal(planner.projectId, 'p1');
    assert.equal(planner.readOnly, false, 'no tools listed means the agent keeps every tool');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a project agent that is on wins over a user agent of the same name, and disabled ones are marked', async () => {
  const { root, home, project } = await workspace();
  try {
    await writeFile(join(home, '.claude', 'agents', 'reviewer.md'), agentFile('reviewer', '用户版', [], '用户版正文。'));
    await writeFile(join(project, '.claude', 'agents', 'reviewer.md'), agentFile('reviewer', '项目版', [], '项目版正文。'));
    const found = discoverAgents({ projects: [{ id: 'p1', path: project }], homeDir: home });
    const saved: AgentRole[] = [{ id: 'executor', name: '执行员', prompt: '内置', readOnly: false, builtIn: true }, { id: 'reviewer', name: '我的审查员', prompt: '自建', readOnly: false }];
    const projectAgent = 'agent:project:p1:reviewer';
    const merged = mergeAgents({ saved, discovered: found, disabled: ['agent:user:reviewer'], enabled: [projectAgent], projectId: 'p1' });
    const byId = (id: string) => merged.find(role => role.id === id);
    assert.equal(byId(projectAgent)?.description, '项目版');
    assert.equal(byId(projectAgent)?.enabled, true);
    assert.equal(byId('agent:user:reviewer')?.enabled, false, 'the user switched this one off');
    assert.equal(byId('agent:user:reviewer')?.shadowedBy, projectAgent);
    assert.equal(byId('reviewer')?.shadowedBy, projectAgent, 'a custom role of the same name steps aside');
    assert.equal(byId('executor')?.shadowedBy, undefined);
    assert.deepEqual(merged.map(role => role.source), ['builtin', 'custom', 'project', 'user']);
    // Only what a task may actually use: on, not replaced, and not another project's.
    assert.deepEqual(usableAgents(mergeAgents({ saved, discovered: found, disabled: [], enabled: [projectAgent], projectId: 'p1' }), 'p1').map(role => role.id), ['executor', projectAgent]);
    // Another project's agent is out of scope, and the user's own agent file takes precedence over the saved role.
    assert.deepEqual(usableAgents(mergeAgents({ saved, discovered: found, disabled: [], enabled: [projectAgent], projectId: 'p2' }), 'p2').map(role => role.id), ['executor', 'agent:user:reviewer']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a project folder’s subagents start off, and one that is off takes no one’s place', () => {
  const saved = [builtIn('explorer', '探索员', true)];
  const discovered = [fileAgent('project', 'explorer')];
  const off = mergeAgents({ saved, discovered, disabled: [], projectId: 'p1' });
  assert.equal(off.find(role => role.id === 'agent:project:p1:explorer')?.enabled, false);
  assert.equal(off.find(role => role.id === 'explorer')?.shadowedBy, undefined, 'a file that is off does not replace the built-in');
  assert.deepEqual(usableAgents(off, 'p1').map(role => role.id), ['explorer']);
  const on = mergeAgents({ saved, discovered, disabled: [], enabled: ['agent:project:p1:explorer'], projectId: 'p1' });
  assert.equal(on.find(role => role.id === 'explorer')?.shadowedBy, 'agent:project:p1:explorer');
  assert.deepEqual(usableAgents(on, 'p1').map(role => role.id), ['agent:project:p1:explorer']);
  const both = mergeAgents({ saved, discovered, disabled: ['agent:project:p1:explorer'], enabled: ['agent:project:p1:explorer'], projectId: 'p1' });
  assert.equal(both.find(role => role.id === 'agent:project:p1:explorer')?.enabled, false, 'switched off wins over a stale switched-on entry');
});

test('usable subagents are worked out per project, even from the list of every project', () => {
  // The renderer holds one list for every project; one project's file must not hide the user's own subagent elsewhere.
  const all = mergeAgents({ saved: [], discovered: [fileAgent('project', 'reviewer'), fileAgent('user', 'reviewer')], disabled: [], enabled: ['agent:project:p1:reviewer'] });
  assert.equal(all.find(role => role.id === 'agent:user:reviewer')?.shadowedBy, undefined, 'without a project nothing is marked on account of a project’s file');
  assert.deepEqual(usableAgents(all, 'p1').map(role => role.id), ['agent:project:p1:reviewer']);
  assert.deepEqual(usableAgents(all, 'p2').map(role => role.id), ['agent:user:reviewer']);
});

test('a 1.2 profile’s built-in ids and switches still mean the same subagents', () => {
  const merged = mergeAgents({ saved: [builtIn('Explore', 'Explore', true)], discovered: [], disabled: ['Explore'] });
  assert.equal(merged[0].id, 'explorer');
  assert.equal(merged[0].enabled, false);
});

test('a lead names a subagent by its id, its file’s name or its 1.2 id', () => {
  const roles = usableAgents(mergeAgents({
    saved: [builtIn('executor', '执行员', false), builtIn('explorer', '探索员', true), { id: 'tester', name: '测试员', prompt: '跑测试。', readOnly: false }],
    discovered: [fileAgent('user', 'Reviewer', { readOnly: true })], disabled: [],
  }));
  assert.equal(findRole(roles, 'tester')?.id, 'tester');
  assert.equal(findRole(roles, 'agent:user:Reviewer')?.id, 'agent:user:Reviewer');
  assert.equal(findRole(roles, 'reviewer')?.id, 'agent:user:Reviewer', 'Claude Code calls a subagent by its name, in any case');
  assert.equal(findRole(roles, 'general-purpose')?.id, 'executor', 'a 1.2 id still works');
  assert.equal(findRole(roles, 'nobody'), undefined);
  assert.deepEqual(roleSummaries(roles), [
    { id: 'executor', label: '执行员', description: '执行员的指令。', readOnly: false },
    { id: 'explorer', label: '探索员', description: '探索员的指令。', readOnly: true },
    { id: 'tester', label: '测试员', description: '跑测试。', readOnly: false },
    { id: 'Reviewer', label: 'Reviewer', description: 'Reviewer 的说明', readOnly: true },
  ]);
});

test('a file that answers to explorer or planner reads as read-only to the lead, whatever its own tools allow', () => {
  const roles = usableAgents(mergeAgents({
    saved: [builtIn('executor', '执行员', false), builtIn('explorer', '探索员', true), builtIn('planner', '规划师', true)],
    discovered: [fileAgent('user', 'Explorer'), fileAgent('user', 'builder')], disabled: [],
  }));
  const byId = (id: string) => roles.find(role => role.id === id)!;
  assert.equal(byId('agent:user:Explorer').readOnly, false, 'the file itself keeps every tool');
  assert.equal(readsOnly(byId('agent:user:Explorer')), true, 'but it answers to the name of a read-only built-in');
  assert.deepEqual(['executor', 'planner', 'agent:user:builder'].map(id => readsOnly(byId(id))), [false, true, false]);
  assert.deepEqual(roleSummaries(roles).map(item => [item.id, item.readOnly]), [['executor', false], ['planner', true], ['Explorer', true], ['builder', false]], 'the lead is not told a stand-in is writable');
});

test('a file named Explore or Plan reads as read-only too: those are the 1.2 ids of explorer and planner', () => {
  const roles = usableAgents(mergeAgents({
    saved: [builtIn('executor', '执行员', false), builtIn('explorer', '探索员', true), builtIn('planner', '规划师', true)],
    discovered: [fileAgent('user', 'Explore'), fileAgent('user', 'plan'), fileAgent('user', 'Planning'), fileAgent('user', 'general-purpose')], disabled: [],
  }));
  const byId = (id: string) => roles.find(role => role.id === id)!;
  // explore is not explorer, so these files shadow nobody by name; asked for by the 1.2 id, a lead reaches the file all the same.
  assert.equal(findRole(roles, 'Explore')?.id, 'agent:user:Explore');
  assert.equal(findRole(roles, 'PLAN')?.id, 'agent:user:plan');
  assert.deepEqual(['Explore', 'plan', 'Planning', 'general-purpose'].map(name => readsOnly(byId(`agent:user:${name}`))), [true, true, false, false], 'the names a read-only built-in answers to, and nothing that merely starts with them');
  assert.deepEqual(roleSummaries(roles).filter(item => item.id !== 'executor').map(item => [item.id, item.readOnly]), [['explorer', true], ['planner', true], ['Explore', true], ['plan', true], ['Planning', false], ['general-purpose', false]], 'the lead is not told these files are writable');
  assert.deepEqual(roles.filter(replacesReadOnlyBuiltIn).map(role => role.id), ['agent:user:Explore', 'agent:user:plan'], 'the settings say why they only read');
});

test('the planner is the built-in or a file that answers to its name, and only those start in plan mode', () => {
  const roles = mergeAgents({
    saved: [builtIn('executor', '执行员', false), builtIn('explorer', '探索员', true), builtIn('planner', '规划师', true), { id: 'reviewer', name: '审查员', prompt: '审查。', readOnly: true }],
    discovered: [fileAgent('user', 'Planner'), fileAgent('user', 'Plan'), fileAgent('user', 'planning'), fileAgent('user', 'Explore')], disabled: [],
  });
  assert.deepEqual(roles.filter(answersAsPlanner).map(role => role.id), ['planner', 'agent:user:Planner', 'agent:user:Plan'], 'the built-in, a file named so, and its 1.2 id Plan');
});

test('the settings page can tell a file that is on in explorer’s or planner’s place', () => {
  const merged = (enabled: string[]) => mergeAgents({
    saved: [builtIn('explorer', '探索员', true), builtIn('planner', '规划师', true), { id: 'tester', name: '测试员', prompt: '跑测试。', readOnly: false }],
    discovered: [fileAgent('user', 'explorer'), fileAgent('project', 'planner'), fileAgent('user', 'builder')], disabled: [], enabled,
  });
  const standIns = (roles: AgentRole[]) => roles.filter(replacesReadOnlyBuiltIn).map(role => role.id);
  assert.deepEqual(standIns(merged([])), ['agent:user:explorer'], 'a project file is off until the user turns it on, and then takes no one’s place');
  assert.deepEqual(standIns(merged(['agent:project:p1:planner'])), ['agent:user:explorer', 'agent:project:p1:planner']);
  assert.deepEqual(standIns(mergeAgents({ saved: [builtIn('explorer', '探索员', true)], discovered: [fileAgent('user', 'explorer')], disabled: ['agent:user:explorer'] })), [], 'switched off, it replaces nothing');
});

test('a 1.2 id still finds a project file that replaced the built-in', () => {
  const roles = usableAgents(mergeAgents({ saved: [builtIn('explorer', '探索员', true)], discovered: [fileAgent('project', 'explorer')], disabled: [], enabled: ['agent:project:p1:explorer'], projectId: 'p1' }), 'p1');
  assert.equal(findRole(roles, 'Explore')?.id, 'agent:project:p1:explorer');
});

test('the line a lead reads is the 说明, or else the first line of the instructions', () => {
  assert.equal(roleDescription({ description: '审查改动，列出风险', prompt: '先读代码。' }), '审查改动，列出风险');
  assert.equal(roleDescription({ description: '  ', prompt: '\n\n  先读代码。\n再写报告。' }), '先读代码。');
  assert.equal(roleDescription({ prompt: 'x'.repeat(400) }).length, 300);
  assert.equal(roleDescription({ description: '第一句。\n第二句。', prompt: '' }), '第一句。 第二句。', 'one line in the tool description');
});

test('why a subagent cannot run, in plain words', () => {
  const roles = mergeAgents({
    saved: [builtIn('explorer', '探索员', true), { id: 'tester', name: '测试员', prompt: '跑测试。', readOnly: false }],
    discovered: [fileAgent('project', 'explorer')], disabled: ['tester'], enabled: ['agent:project:p1:explorer'], projectId: 'p1',
  });
  assert.equal(roleUnavailable(roles, 'agent:project:p1:explorer', 'p1'), undefined);
  assert.equal(roleUnavailable(roles, 'tester', 'p1'), '子代理「测试员」已关闭。');
  assert.equal(roleUnavailable(roles, 'explorer', 'p1'), '子代理「探索员」被同名的「explorer」顶替了。');
  assert.equal(roleUnavailable(roles, 'gone', 'p1'), '找不到子代理「gone」，它可能已被删除。');
});

test('a subagent asked for by its file’s name says it is off, not that it is gone', () => {
  const roles = mergeAgents({
    saved: [builtIn('explorer', '探索员', true), { id: 'tester', name: '测试员', prompt: '跑测试。', readOnly: false }],
    discovered: [fileAgent('project', 'reviewer'), fileAgent('user', 'helper')], disabled: ['agent:user:helper'], projectId: 'p1',
  });
  // The project’s file is off until it is switched on, and the user switched theirs off: both exist, so neither is 「找不到」.
  assert.equal(roleUnavailable(roles, 'reviewer', 'p1'), '子代理「reviewer」已关闭。');
  assert.equal(roleUnavailable(roles, 'Helper', 'p1'), '子代理「helper」已关闭。', 'a name in any case');
  assert.equal(roleUnavailable(roles, 'agent:project:p1:reviewer', 'p1'), '子代理「reviewer」已关闭。', 'by id it said so already');
  assert.equal(roleUnavailable(roles, 'reviewer', 'other'), '找不到子代理「reviewer」，它可能已被删除。', 'another project’s file is not this project’s subagent');
  assert.equal(roleUnavailable(roles, 'nobody', 'p1'), '找不到子代理「nobody」，它可能已被删除。');
  assert.equal(roleUnavailable(roles, 'tester', 'p1'), undefined, 'one that is on is no problem');
  // A name that reaches a subagent that is on, whichever file holds it, is no problem either.
  assert.equal(roleUnavailable(mergeAgents({ saved: [], discovered: [fileAgent('user', 'helper')], disabled: [] }), 'helper'), undefined);
});

test('a task keeps the exact subagent it was made with: a file that only answers to the same name is no reason to run, and the refusal always says why', () => {
  // The custom subagent “helper” was removed, and a file of that name is on.
  const roles = mergeAgents({ saved: [builtIn('executor', '执行员', false)], discovered: [fileAgent('user', 'helper')], disabled: [] });
  assert.equal(roleUnavailable(roles, 'helper'), undefined, 'asked for by name, the file answers');
  assert.equal(roleUnavailable(roles, 'helper', undefined, { exact: true }), '找不到子代理「helper」，它可能已被删除。', 'a task made as “helper” is not the file');
  assert.equal(roleUnavailable(roles, 'agent:user:helper', undefined, { exact: true }), undefined, 'a task made as the file is');
  // Where one exists under that id but is off or replaced, the reasons are the same either way.
  const withCustom = mergeAgents({ saved: [builtIn('executor', '执行员', false), { id: 'helper', name: '帮手', prompt: '帮忙。', readOnly: false }], discovered: [fileAgent('user', 'helper')], disabled: [] });
  assert.equal(roleUnavailable(withCustom, 'helper', undefined, { exact: true }), '子代理「帮手」被同名的「helper」顶替了。');
});

test('a subagent that is gone is named as the user knows it, not by the id the app keeps for a file', () => {
  const roles = mergeAgents({ saved: [builtIn('executor', '执行员', false)], discovered: [fileAgent('project', 'reviewer')], disabled: [], projectId: 'p1' });
  for (const exact of [false, true]) {
    assert.equal(roleUnavailable(roles, 'agent:user:gone', 'p1', { exact }), '找不到子代理「gone」，它可能已被删除。');
    assert.equal(roleUnavailable(roles, 'agent:project:p1:gone', 'p1', { exact }), '找不到子代理「gone」，它可能已被删除。');
    assert.equal(roleUnavailable(roles, 'plain-id', 'p1', { exact }), '找不到子代理「plain-id」，它可能已被删除。', 'any other id is shown as it is');
  }
  assert.equal(roleLabel('agent:project:p1:reviewer'), 'reviewer');
  assert.equal(roleLabel('agent:user:Explore'), 'Explore');
  assert.equal(roleLabel('tester'), 'tester');
});

test('discovery stays bounded and survives an unreadable folder', async () => {
  const { root, home, project } = await workspace();
  try {
    for (let index = 0; index < 60; index++) await writeFile(join(home, '.claude', 'agents', `agent-${index}.md`), agentFile(`agent-${index}`, `第 ${index} 个`, [], '正文。'));
    await writeFile(join(home, '.claude', 'agents', 'huge.md'), agentFile('huge', '正文超长', [], 'x'.repeat(300_000)));
    const found = discoverAgents({ projects: [{ id: 'p1', path: join(project, 'gone') }], homeDir: home, limit: 50 });
    assert.equal(found.length, 50, 'the limit holds');
    assert.equal(found.some(agent => agent.name === 'huge'), false, 'an oversized file is left out');
  } finally { await rm(root, { recursive: true, force: true }); }
});
