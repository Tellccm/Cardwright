import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVariableTable, serializeVariableTable, type VariableTable } from '../src/shared/card-studio/variable-table.ts';
import { VARIABLE_TABLE_FILE, readVariableTableState, writeVariableTable } from '../src/core/card-studio/variable-artifacts.ts';

const table: VariableTable = {
  version: 1,
  note: '测试用',
  rows: [
    { path: '/主角', type: '对象', owner: '模型' },
    { path: '/主角/生命', type: '数值', owner: '模型', default: 100, range: [0, 100], note: '掉到 0 就结束', when: '受伤或治疗时' },
    { path: '/主角/姓名', type: '文本', owner: '创角页', default: '' },
    { path: '/主角/存活', type: '布尔', owner: '模型', default: true },
    { path: '/主角/阵营', type: '枚举', owner: '模型', default: '中立', values: ['善', '中立', '恶'] },
    { path: '/背包', type: '列表', owner: '脚本', element: '文本', limit: 20 },
    { path: '/关系', type: '记录', owner: '模型', limit: 30 },
    { path: '/关系/{键}', type: '数值', owner: '模型', default: 0, range: [-100, 100] },
  ],
};

test('an edited table survives the round trip the card actually loads with', () => {
  const text = serializeVariableTable(table);
  const parsed = parseVariableTable(text);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.note, '测试用');
  assert.deepEqual(parsed.rows.map(row => row.path), table.rows.map(row => row.path));

  const life = parsed.rows.find(row => row.path === '/主角/生命')!;
  assert.equal(life.default, 100);
  assert.deepEqual(life.range, [0, 100]);
  assert.equal(life.when, '受伤或治疗时');

  const side = parsed.rows.find(row => row.path === '/主角/阵营')!;
  assert.deepEqual(side.values, ['善', '中立', '恶']);

  const bag = parsed.rows.find(row => row.path === '/背包')!;
  assert.equal(bag.element, '文本');
  assert.equal(bag.limit, 20);
  assert.equal(bag.owner, '脚本');

  assert.equal(parsed.rows.find(row => row.path === '/主角/存活')!.default, true);
});

test('an edit that would not load again is refused before it is written', () => {
  // A record's key placeholder cannot hang off a leaf.
  assert.throws(() => parseVariableTable(serializeVariableTable({
    version: 1, rows: [{ path: '/数值', type: '数值', owner: '模型', default: 0 }, { path: '/数值/{键}', type: '文本', owner: '模型', default: '' }],
  })));
  // An empty table is refused.
  assert.throws(() => parseVariableTable(serializeVariableTable({ version: 1, rows: [] })));
  // A path that is not a pointer is refused.
  assert.throws(() => parseVariableTable(serializeVariableTable({ version: 1, rows: [{ path: '主角', type: '文本', owner: '模型', default: '' }] })));
});

test('saving writes 变量表.yaml where the card project reads it from', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cardwright-vartable-'));
  try {
    mkdirSync(dir, { recursive: true });
    await writeVariableTable(dir, serializeVariableTable(table));
    assert.ok(existsSync(join(dir, VARIABLE_TABLE_FILE)));
    const state = await readVariableTableState(dir);
    assert.equal(state.source, 'authored');
    assert.equal(state.source === 'authored' ? state.table.rows.length : 0, table.rows.length);

    // Editing a default and saving again replaces the file rather than appending to it.
    const changed = { ...table, rows: table.rows.map(row => row.path === '/主角/生命' ? { ...row, default: 42 } : row) };
    await writeVariableTable(dir, serializeVariableTable(changed));
    const again = await readVariableTableState(dir);
    assert.equal(again.source === 'authored' ? again.table.rows.find(row => row.path === '/主角/生命')!.default : null, 42);
    assert.equal(readFileSync(join(dir, VARIABLE_TABLE_FILE), 'utf8').match(/路径: \/主角\/生命/g)?.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a table with a stray file beside it still reads back cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cardwright-vartable-'));
  try {
    await writeVariableTable(dir, serializeVariableTable(table));
    writeFileSync(join(dir, 'unrelated.txt'), 'ignore me');
    const state = await readVariableTableState(dir);
    assert.equal(state.source, 'authored');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('adding a nested row fills in the containers the table requires', async () => {
  const { withParentRows } = await import('../src/renderer/card-studio/VariableTableEditor.tsx');
  // What a user types: one row, several levels deep, with no containers.
  const filled = withParentRows([
    { path: '/主角/状态/生命', type: '数值', owner: '模型', default: 100 },
    { path: '/关系/{键}/好感', type: '数值', owner: '模型', default: 0 },
    { path: '/背包/-/名称', type: '文本', owner: '脚本', default: '' },
  ]);
  const byPath = new Map(filled.map(row => [row.path, row]));
  assert.equal(byPath.get('/主角')!.type, '对象');
  assert.equal(byPath.get('/主角/状态')!.type, '对象');
  assert.equal(byPath.get('/关系')!.type, '记录', 'a key placeholder makes its parent a record');
  assert.equal(byPath.get('/背包')!.type, '列表', 'an element placeholder makes its parent a list');
  // A placeholder itself is never a row: its fields describe it.
  assert.equal(byPath.has('/关系/{键}'), false);
  assert.equal(byPath.has('/背包/-'), false);
  // Parents come first, so the table parses.
  assert.ok(filled.findIndex(row => row.path === '/主角') < filled.findIndex(row => row.path === '/主角/状态'));
  assert.doesNotThrow(() => parseVariableTable(serializeVariableTable({ version: 1, rows: filled })));

  // A table that already names its containers is left exactly as it was.
  const untouched = withParentRows(table.rows);
  assert.deepEqual(untouched.map(row => row.path), table.rows.map(row => row.path));
});
