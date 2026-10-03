import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRoleId, canonicalRoleKeys, isReservedRoleId, RESERVED_ROLE_IDS, savedCustomRoles } from '../src/shared/agents.ts';
import { describeRoles } from '../src/runtime/ecosystem-workflow.ts';
import type { AgentRole } from '../src/shared/types.ts';

test('the 1.2 built-in ids, in any case, become executor / explorer / planner; every other id is left alone', () => {
  assert.equal(canonicalRoleId('general-purpose'), 'executor');
  assert.equal(canonicalRoleId('Explore'), 'explorer');
  assert.equal(canonicalRoleId('explore'), 'explorer');
  assert.equal(canonicalRoleId('Plan'), 'planner');
  for (const id of ['executor', 'explorer', 'planner', 'researcher', 'writer', 'reviewer', 'Explorer', 'agent:project:p1:Plan', 'constructor', '__proto__', '']) assert.equal(canonicalRoleId(id), id);
});

test('a custom role can take none of the reserved ids, however it is spelled', () => {
  assert.deepEqual([...RESERVED_ROLE_IDS], ['executor', 'explorer', 'planner', 'researcher', 'writer']);
  for (const id of ['executor', 'EXPLORER', 'Planner', 'researcher', 'writer', 'general-purpose', 'Explore', 'plan']) assert.equal(isReservedRoleId(id), true, id);
  for (const id of ['reviewer', 'writer-2', 'planner-custom', 'agent:user:writer']) assert.equal(isReservedRoleId(id), false, id);
});

test('records keyed by role id move to the new ids; an entry already under a new id wins', () => {
  assert.deepEqual(canonicalRoleKeys({ Explore: 'old explore', explorer: 'new explorer', 'general-purpose': 'old general', reviewer: 'custom' }), { explorer: 'new explorer', reviewer: 'custom', executor: 'old general' });
  const tricky = canonicalRoleKeys(JSON.parse('{"__proto__":{"polluted":true},"constructor":"c"}') as Record<string, unknown>);
  assert.deepEqual(Object.keys(tricky).sort(), ['__proto__', 'constructor']);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('a saved role list keeps its custom roles, drops built-in copies and moves a custom role off a reserved id', () => {
  const saved: AgentRole[] = [
    { id: 'general-purpose', name: 'General purpose', prompt: 'old', readOnly: false, builtIn: true },
    { id: 'Explore', name: 'Explore', prompt: 'old', readOnly: true },
    { id: 'reviewer', name: '审查员', prompt: '只看不改。', readOnly: true },
    { id: 'planner', name: '我的规划', prompt: '按我的格式写计划。', readOnly: false },
    { id: 'planner-custom', name: '已有的', prompt: '已有。', readOnly: false },
  ];
  const { roles, renamed } = savedCustomRoles(saved);
  assert.deepEqual(roles.map(role => role.id), ['reviewer', 'planner-custom-2', 'planner-custom'], 'a 1.2 id is never a custom role, even without the flag');
  assert.deepEqual([...renamed], [['planner', 'planner-custom-2']]);
  assert.deepEqual(roles[1], { id: 'planner-custom-2', name: '我的规划', prompt: '按我的格式写计划。', readOnly: false });
});

test('the dispatch tools list each role as `编号`（界面名）：一句说明, read-only ones marked', () => {
  assert.equal(describeRoles([
    { id: 'executor', label: '执行员', description: '通用执行', readOnly: false },
    { id: 'reviewer', label: '审查员', description: '只看代码，交回问题清单。', readOnly: true },
  ]), '- `executor`（执行员）：通用执行\n- `reviewer`（审查员）：只看代码，交回问题清单；只读');
});
