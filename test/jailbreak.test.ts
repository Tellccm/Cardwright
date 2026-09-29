import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleJailbreak, expandMacros, normalizeJailbreakPack, readPreset, unresolvedMacros, type JailbreakPack } from '../src/shared/jailbreak.ts';
import { createJailbreakExtension } from '../src/runtime/jailbreak-runtime.ts';
import { JailbreakStore } from '../src/main/jailbreak-store.ts';

const variables = { user: '顾清寒', char: '龙族remake' };

test('the macros Cardwright can answer are replaced, the tavern-only ones drop, the rest are passed on untouched', () => {
  assert.equal(expandMacros('给 {{user}} 写 {{char}} 的故事。', variables), '给 顾清寒 写 龙族remake 的故事。');
  assert.equal(expandMacros('{{//\n这是注释\n}}正文', variables), '正文');
  assert.equal(expandMacros('前{{setvar::seal::<x>y</x>}}后', variables), '前后');
  // An author's own macro is their text; deleting it silently would be worse than sending it.
  assert.equal(expandMacros('掷骰 {{roll 1d6}}', variables), '掷骰 {{roll 1d6}}');
  assert.deepEqual(unresolvedMacros('{{user}} {{roll 1d6}} {{//x}} {{random::a::b}}'), ['{{roll 1d6}}', '{{random::a::b}}']);
});

test('a pack becomes system text, an opening exchange and a tail, in the order the author wrote', () => {
  const pack: JailbreakPack = { id: 'p', name: 'p', entries: [
    { id: 'a', name: 'A', role: 'system', placement: 'system', content: '第一段' },
    { id: 'b', name: 'B', role: 'system', placement: 'system', content: '第二段' },
    { id: 'c', name: 'C', role: 'assistant', placement: 'opening', content: '好的，{{user}}。' },
    { id: 'd', name: 'D', role: 'user', placement: 'opening', content: '写下去。' },
    { id: 'e', name: 'E', role: 'system', placement: 'tail', content: '从断处继续。' },
    { id: 'f', name: 'F', role: 'system', placement: 'opening', content: '没有座位的系统条目' },
    { id: 'g', name: 'G', role: 'user', placement: 'opening', content: '   ' },
  ] };
  const assembled = assembleJailbreak(pack, variables)!;
  assert.equal(assembled.system, '第一段\n\n第二段\n\n没有座位的系统条目');
  assert.deepEqual(assembled.opening, [
    { role: 'assistant', content: '好的，顾清寒。' },
    { role: 'user', content: '写下去。' },
  ]);
  assert.equal(assembled.tail, '从断处继续。');
  assert.equal(assembleJailbreak(undefined, variables), undefined);
  assert.equal(assembleJailbreak({ id: 'x', name: 'x', entries: [] }, variables), undefined);
});

test('a preset is read into entries whose placement follows its own order around the chat history', () => {
  const preset = {
    name: '测试预设',
    prompts: [
      { identifier: 'front', name: '前置', role: 'system', content: '前置内容' },
      { identifier: 'echo', name: '回应', role: 'assistant', content: '回应内容' },
      { identifier: 'chatHistory', name: 'Chat History', role: 'system', marker: true, content: '' },
      { identifier: 'after', name: '收尾', role: 'system', content: '收尾内容' },
      { identifier: 'depth', name: '深度注入', role: 'system', injection_position: 1, content: '注入内容' },
      { identifier: 'blank', name: '空的', role: 'system', content: '   ' },
    ],
    prompt_order: [{ character_id: 1, order: [
      { identifier: 'front', enabled: true }, { identifier: 'depth', enabled: true }, { identifier: 'echo', enabled: false },
      { identifier: 'chatHistory', enabled: true }, { identifier: 'after', enabled: true }, { identifier: 'blank', enabled: true },
    ] }],
  };
  const read = readPreset(preset);
  assert.equal(read.name, '测试预设');
  assert.deepEqual(read.entries.map(entry => [entry.id, entry.placement, entry.enabled]), [
    ['front', 'system', true],
    // An in-chat injection has no equivalent seat here, so it becomes a tail entry.
    ['depth', 'tail', true],
    ['echo', 'opening', false],
    ['after', 'tail', true],
  ]);
  // Markers hold no text of their own and empty entries are skipped.
  assert.equal(read.entries.some(entry => entry.id === 'chatHistory' || entry.id === 'blank'), false);
});

test('a malformed pack is refused before it can be used', () => {
  assert.throws(() => normalizeJailbreakPack({ id: 'bad id!', name: 'x', entries: [{ content: 'a', placement: 'system' }] }), /标识/);
  assert.throws(() => normalizeJailbreakPack({ id: 'ok', name: '', entries: [{ content: 'a', placement: 'system' }] }), /名称/);
  assert.throws(() => normalizeJailbreakPack({ id: 'ok', name: 'x', entries: [] }), /至少/);
  assert.throws(() => normalizeJailbreakPack({ id: 'ok', name: 'x', entries: [{ content: 'a', placement: 'elsewhere' }] }), /位置/);
  const pack = normalizeJailbreakPack({ id: 'ok', name: ' 名字 ', entries: [{ content: '正文', placement: 'system', role: 'nonsense' }] });
  assert.equal(pack.name, '名字');
  assert.equal(pack.entries[0].role, 'system');
});

test('the opening exchange leads every request and the tail rides the newest user message', () => {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const assembled = { system: 'S', opening: [{ role: 'user' as const, content: '开场问' }, { role: 'assistant' as const, content: '开场答' }], tail: '尾部' };
  createJailbreakExtension(() => assembled)({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
  const original = [
    { role: 'user', content: '第一句', timestamp: 1 },
    { role: 'assistant', content: [{ type: 'text', text: '回答' }], timestamp: 2 },
    { role: 'user', content: [{ type: 'text', text: '最后一句' }], timestamp: 3 },
  ];
  const result = handlers.get('context')!({ type: 'context', messages: [...original] }, {});
  // An injected turn must look like one the session itself stored: content parts,
  // and for an assistant turn a stop reason, a usage and its provider fields.
  assert.deepEqual(result.messages[0], { role: 'user', content: [{ type: 'text', text: '开场问' }], timestamp: 0 });
  const injectedReply = result.messages[1] as Record<string, unknown>;
  assert.equal(injectedReply.role, 'assistant');
  assert.deepEqual(injectedReply.content, [{ type: 'text', text: '开场答' }]);
  assert.equal(injectedReply.stopReason, 'stop');
  assert.deepEqual(injectedReply.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(result.messages[4].content, [{ type: 'text', text: '最后一句' }, { type: 'text', text: '尾部' }]);
  // The agent's own messages must not be edited, or the tail would pile up over a turn.
  assert.deepEqual(original[2].content, [{ type: 'text', text: '最后一句' }]);
  const twice = handlers.get('context')!({ type: 'context', messages: result.messages }, {});
  assert.equal(JSON.stringify(twice.messages).split('尾部').length - 1, 2, 'each call appends the tail once, to its own copy');

  // With the toggle off nothing is touched at all.
  const off = new Map<string, (event: any, ctx: any) => any>();
  createJailbreakExtension(() => undefined)({ on: (name: string, handler: any) => off.set(name, handler) } as any);
  assert.equal(off.get('context')!({ type: 'context', messages: original }, {}), undefined);
});

test('the built-in packs that ship with the application load and validate', () => {
  const root = join(process.cwd(), 'card-studio');
  for (const file of ['破限-普通.json', '破限-严格.json']) {
    const path = join(root, 'prompts', file);
    assert.ok(existsSync(path), `${file} is generated by scripts/extract-jailbreak-pack.mjs and committed`);
    const pack = normalizeJailbreakPack(JSON.parse(readFileSync(path, 'utf8')));
    assert.ok(pack.entries.length > 0);
    assert.equal(pack.builtIn, true);
    // The assembled result must have all three placements represented as the handoff describes.
    const assembled = assembleJailbreak(pack, variables)!;
    assert.ok(assembled.system.length > 0);
    assert.ok(assembled.opening.length > 0);
    // Nothing the app cannot resolve should remain in a shipped pack.
    for (const entry of pack.entries) assert.deepEqual(unresolvedMacros(entry.content), [], `${entry.name} still contains a tavern macro`);
  }
  const strict = normalizeJailbreakPack(JSON.parse(readFileSync(join(root, 'prompts', '破限-严格.json'), 'utf8')));
  assert.ok(assembleJailbreak(strict, variables)!.tail.length > 0, 'the strict pack ends with a tail entry');
});

test('the store lists both built-in packs, saves an imported one and refuses to delete a built-in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cardwright-jailbreak-'));
  try {
    const store = new JailbreakStore(dir, join(process.cwd(), 'card-studio'));
    const listed = store.list();
    assert.deepEqual(listed.filter(item => item.builtIn).map(item => item.id).sort(), ['builtin-normal', 'builtin-strict']);

    store.save({ id: 'mine', name: '我的破限', entries: [{ id: 'a', name: 'A', role: 'system', placement: 'system', content: '给 {{user}} 的' }] });
    assert.equal(store.list().length, 3);
    assert.equal(store.resolve({ pack: 'mine' }, variables)!.system, '给 顾清寒 的');

    // A user pack of the same id is how a built-in one is edited.
    store.save({ id: 'builtin-normal', name: '我改过的普通破限', entries: [{ id: 'a', name: 'A', role: 'system', placement: 'system', content: '改过的' }] });
    assert.equal(store.read('builtin-normal')!.name, '我改过的普通破限');
    assert.equal(store.list().find(item => item.id === 'builtin-normal')!.builtIn, true);

    store.remove('builtin-normal');
    assert.equal(store.read('builtin-normal')!.name, '普通破限', 'removing the edit restores the shipped text');
    assert.throws(() => store.remove('builtin-strict'), /不能删除/);

    // A pack that has gone turns the toggle off instead of failing the run.
    assert.equal(store.resolve({ pack: 'missing' }, variables), undefined);
    assert.equal(store.resolve(undefined, variables), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
