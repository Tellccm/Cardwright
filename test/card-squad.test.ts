import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LORE_DIRS, CARD_ROLES, DEFAULT_CARD_SQUAD, SELF_DISPATCH_END, SELF_DISPATCH_OFF, SELF_DISPATCH_ON, cardDispatchRoles, cardMemberKind, cardMemberLabel, cardMemberTools, cardRoleId, cardSquadSettings, checkAssignment, claimAssignment, componentStem, effectiveSelfDispatch, heldFiles, isCardMember, isComponentFile, normalizeCardSquad, sharedCardFile, squadClaims, squadDispatchPrompt } from '../src/shared/card-studio/squad.ts';
import { LORE_FOLDERS } from '../src/core/card-studio/components.ts';

test('the squad switch is off by default with 自行组队 on; a known mode is kept and a missing 自行组队 takes its default', () => {
  assert.deepEqual(DEFAULT_CARD_SQUAD, { mode: 'off', selfDispatch: true });
  assert.deepEqual(cardSquadSettings({}), { mode: 'off', selfDispatch: true });
  assert.deepEqual(cardSquadSettings({ cardSquad: { mode: 'write', selfDispatch: false } }), { mode: 'write', selfDispatch: false });
  assert.deepEqual(normalizeCardSquad({ mode: 'read' }), { mode: 'read', selfDispatch: true });
  for (const broken of [null, [], 'write', { mode: 'all', selfDispatch: true }, { selfDispatch: false }]) {
    assert.equal(normalizeCardSquad(broken), undefined, JSON.stringify(broken));
    assert.deepEqual(cardSquadSettings({ cardSquad: broken }), { mode: 'off', selfDispatch: true });
  }
});

test('with the switch off only Ultra planning dispatches, and choosing Ultra is the consent', () => {
  assert.equal(effectiveSelfDispatch({ mode: 'off', selfDispatch: false }), true);
  assert.equal(effectiveSelfDispatch({ mode: 'read', selfDispatch: false }), false);
  assert.equal(effectiveSelfDispatch({ mode: 'write', selfDispatch: true }), true);
});

test('who may send whom (spec §6.1)', () => {
  const off = cardSquadSettings({});
  const read = { mode: 'read', selfDispatch: true } as const;
  const write = { mode: 'write', selfDispatch: false } as const;
  assert.deepEqual(cardDispatchRoles({ settings: off, sectionId: 'lore-people', thinking: 'high', member: false }), []);
  assert.deepEqual(cardDispatchRoles({ settings: off, sectionId: 'plan', thinking: 'ultra', member: false }), ['researcher'], 'Ultra planning still reads');
  assert.deepEqual(cardDispatchRoles({ settings: off, sectionId: 'lore-people', thinking: 'ultra', member: false }), ['researcher', 'writer'], 'Ultra in a section sends both, whatever the switch (1.3.2)');
  assert.deepEqual(cardDispatchRoles({ settings: read, sectionId: 'lore-people', thinking: 'ultra', member: false }), ['researcher', 'writer']);
  assert.deepEqual(cardDispatchRoles({ settings: off, sectionId: 'lore-people', thinking: 'ultra', member: true }), [], 'a member never sends anyone, even under Ultra');
  assert.deepEqual(cardDispatchRoles({ settings: read, sectionId: 'lore-people', thinking: 'medium', member: false }), ['researcher']);
  assert.deepEqual(cardDispatchRoles({ settings: write, sectionId: 'plan', thinking: 'medium', member: false }), ['researcher', 'writer']);
  assert.deepEqual(cardDispatchRoles({ settings: write, sectionId: 'lore-people', thinking: 'medium', member: true }), [], 'a member never sends anyone');
});

test('a lead names a member by id or label; no role means 查资料; a role it may not send is refused with the ones it may', () => {
  for (const name of ['researcher', 'Researcher', '查资料', 'explorer', 'Explore']) assert.equal(cardRoleId(name), 'researcher', name);
  for (const name of ['writer', '写组件']) assert.equal(cardRoleId(name), 'writer', name);
  assert.equal(cardRoleId('executor'), null);
  assert.deepEqual([CARD_ROLES.researcher.readOnly, CARD_ROLES.writer.readOnly], [true, false]);
  assert.deepEqual([CARD_ROLES.researcher.label, CARD_ROLES.writer.label], ['查资料', '写组件']);
  assert.equal(cardMemberKind('', ['researcher', 'writer']), 'researcher');
  assert.equal(cardMemberKind('写组件', ['researcher', 'writer']), 'writer');
  assert.throws(() => cardMemberKind('researcher', []), /不能派小队成员/);
  assert.throws(() => cardMemberKind('writer', ['researcher']), /能派的只有：查资料（researcher）/);
  assert.throws(() => cardMemberKind('executor', ['researcher', 'writer']), /不是工坊能派的成员/);
});

test('members get exactly their tools (spec §6.2)', () => {
  assert.deepEqual(cardMemberTools('researcher', false), ['read', 'ls', 'card_search_sources', 'card_check']);
  assert.deepEqual(cardMemberTools('researcher', true), ['read', 'ls', 'card_search_sources', 'card_check', 'web_search', 'fetch_content']);
  assert.deepEqual(cardMemberTools('writer', false), ['read', 'ls', 'card_search_sources', 'card_check', 'write', 'edit', 'card_new_component']);
  for (const role of ['researcher', 'writer'] as const) for (const web of [false, true]) {
    for (const banned of ['powershell', 'host_command', 'ask_user_question', 'dispatch_member', 'dispatch_team', 'member_result', 'message_member', 'card_sync_variables', 'card_add_dispatches', 'browser_open', 'todo']) assert.ok(!cardMemberTools(role, web).includes(banned), `${role} ${banned}`);
  }
});

test('a squad member is told apart from a conversation', () => {
  assert.equal(isCardMember({ card: { sectionId: 'plan', member: true } }), true);
  assert.equal(isCardMember({ card: { sectionId: 'plan' } }), false);
  assert.equal(isCardMember({}), false);
});

test('a member is shown by its kind and name; a 1.2 reading-squad member counts as 查资料', () => {
  assert.equal(cardMemberLabel({ agentName: '白骨精', title: 'x', card: { sectionId: 'lore-people', member: true, squad: { role: 'writer', files: [], create: ['黄袍怪'] } } }), '写组件 · 白骨精');
  assert.equal(cardMemberLabel({ agentName: '甲队员', title: 'x', card: { sectionId: 'plan', member: true } }), '查资料 · 甲队员');
});

test('the shared files stay with the lead, wherever the card project layout puts them (spec §6.3)', () => {
  for (const path of ['设计书.md', '变量表.yaml', '卡项目.json', '世界书/人设/出处索引.md', '世界书/剧情/出处索引.md', '世界书/人设/人物模板.md', '世界书/剧情/剧情模板.md', '世界书/人设/10-人物总览.md', '世界书/人设/10-人物总览.json', '世界书/总览/10-地点总览.md', '世界书/剧情/15-标题剧情索引.md', '世界书/剧情/15-标题剧情索引~42.md', '世界书\\人设\\-3-人物总览.md']) assert.equal(sharedCardFile(path), true, path);
  for (const path of ['世界书/人设/120-红孩儿.md', '世界书/人设/120-人物总览（旧）.md', '正则/01-状态栏.yaml', '资料/索引.md', '设计书备份.md']) assert.equal(sharedCardFile(path), false, path);
  assert.equal(componentStem('15-标题剧情索引~42.md'), '标题剧情索引');
  assert.equal(componentStem('10.5-人物总览.json'), '人物总览');
});

test('files names component files only, in the folders the card project has', () => {
  assert.deepEqual([...CARD_LORE_DIRS].sort(), Object.values(LORE_FOLDERS).sort(), 'the same folders as the component reader');
  for (const path of ['世界书/人设/120-红孩儿.md', '世界书/人设/120-红孩儿.json', '世界书/未分类/3-旧条目.md', '正则/01-状态栏.yaml', '正则/01-状态栏.json', '正则/02-美化.html', '脚本/01-控制器.js', '开场白/00-开场.md', '开场白/群聊/01-群.md']) assert.equal(isComponentFile(path), true, path);
  for (const path of ['资料/分章/西游记/0003.txt', '世界书/人设/sub/1-x.md', '世界书/.cardwright-book.json', '正则/01-x.js', '脚本/01-x.md', '导出/卡.json', '设计书.md']) assert.equal(isComponentFile(path), false, path);
});

test('only a 写组件 has files or create, and it must have one of them (spec §5.2, §6.3)', () => {
  assert.deepEqual(checkAssignment('writer', { files: [' 世界书/人设/120-红孩儿.md ', '世界书/人设/120-红孩儿.md'], create: ['黄袍怪'] }), { role: 'writer', files: ['世界书/人设/120-红孩儿.md'], create: ['黄袍怪'] });
  assert.deepEqual(checkAssignment('researcher', {}), { role: 'researcher', files: [], create: [] });
  assert.throws(() => checkAssignment('researcher', { files: ['世界书/人设/120-红孩儿.md'] }), /files 和 create 只给「写组件」用/);
  assert.throws(() => checkAssignment('writer', {}), /要写明它写哪些组件/);
  assert.throws(() => checkAssignment('writer', { create: ['人物总览'] }), /共享组件/);
  assert.throws(() => checkAssignment('writer', { create: ['甲/乙'] }), /不能当组件名称/);
  assert.throws(() => checkAssignment('writer', { create: Array.from({ length: 21 }, (_value, index) => `人物${index}`) }), /最多分 20 个文件、新建 20 个组件/);
});

test('two working writers never share a file or a new component', () => {
  const claims = { files: new Set<string>(), create: new Set<string>() };
  claimAssignment(claims, { role: 'writer', files: ['世界书/人设/120-红孩儿.md'], create: ['黄袍怪'] });
  assert.throws(() => claimAssignment(claims, { role: 'writer', files: ['世界书/人设/120-红孩儿.md'], create: [] }), /已经分给了别的成员/);
  assert.throws(() => claimAssignment(claims, { role: 'writer', files: [], create: ['黄袍怪'] }), /已经分给了别的成员/);
  claimAssignment(claims, { role: 'researcher', files: [], create: [] });
});

test('a 写组件 also holds the components it created, wherever it is claimed against', () => {
  const made = { role: 'writer' as const, files: ['世界书/人设/120-红孩儿.md'], create: ['黄袍怪'], created: [{ name: '黄袍怪', paths: ['世界书/人设/130-黄袍怪.md', '世界书/人设/130-黄袍怪.json'] }] };
  assert.deepEqual(heldFiles(made), ['世界书/人设/120-红孩儿.md', '世界书/人设/130-黄袍怪.md', '世界书/人设/130-黄袍怪.json']);
  // Working, it keeps others off them.
  assert.throws(() => claimAssignment(squadClaims([made]), { role: 'writer', files: ['世界书/人设/130-黄袍怪.md'], create: [] }), /「世界书\/人设\/130-黄袍怪\.md」已经分给了别的成员/);
  // Returning, it cannot come back onto them while another holds one.
  assert.throws(() => claimAssignment(squadClaims([{ role: 'writer', files: ['世界书/人设/130-黄袍怪.JSON'], create: [] }]), made), /已经分给了别的成员/);
  claimAssignment(squadClaims([{ role: 'writer', files: ['世界书/人设/121-别人.md'], create: [] }]), made);
});

test('the 派发 rules keep the 自行组队 variant in effect and drop the markers', () => {
  const text = ['## 小队', '', '### 什么时候派', '', SELF_DISPATCH_ON, '- 自己判断。', SELF_DISPATCH_OFF, '- 只在用户要求时派。', SELF_DISPATCH_END, '', '### 收尾', '- 等成员回来。'].join('\n');
  assert.equal(squadDispatchPrompt(text, { selfDispatch: true }), ['## 小队', '', '### 什么时候派', '', '- 自己判断。', '', '### 收尾', '- 等成员回来。'].join('\n'));
  assert.equal(squadDispatchPrompt(text, { selfDispatch: false }), ['## 小队', '', '### 什么时候派', '', '- 只在用户要求时派。', '', '### 收尾', '- 等成员回来。'].join('\n'));
  assert.equal(squadDispatchPrompt('## 小队\n改过的版本，没有标记。', { selfDispatch: false }), '## 小队\n改过的版本，没有标记。', 'an override without the markers is used as written');
});

test('an override whose 自行组队 markers do not pair up is used as written, so no rule after them is lost', () => {
  const tail = ['', '### 收尾', '- 等成员回来。'];
  const noEnd = ['## 小队', SELF_DISPATCH_ON, '- 自己判断。', SELF_DISPATCH_OFF, '- 只在用户要求时派。', ...tail].join('\n');
  for (const selfDispatch of [true, false]) assert.equal(squadDispatchPrompt(noEnd, { selfDispatch }), noEnd, `自行组队 ${selfDispatch}`);
  const strayEnd = ['## 小队', '- 自己判断。', SELF_DISPATCH_END, ...tail].join('\n');
  assert.equal(squadDispatchPrompt(strayEnd, { selfDispatch: true }), strayEnd);
  const twoOpen = ['## 小队', SELF_DISPATCH_ON, '- 自己判断。', SELF_DISPATCH_END, SELF_DISPATCH_OFF, '- 只在用户要求时派。', ...tail].join('\n');
  assert.equal(squadDispatchPrompt(twoOpen, { selfDispatch: true }), twoOpen);
});
