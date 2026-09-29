import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../context';
import { Modal } from '../primitives';
import {
  ELEMENT_PLACEHOLDER, KEY_PLACEHOLDER, VARIABLE_ELEMENTS, VARIABLE_OWNERS, VARIABLE_TYPES,
  isLeaf, type VariableRow,
} from '../../shared/card-studio/variable-table';

/**
 * 变量表编辑器 — the variable table as a table.
 *
 * The 变量表 is the single source of truth for a card's variables: the Zod
 * schema, the initial values, the variable list, the output format and the
 * front-end's references are all generated from it. Until now changing a
 * default meant asking the section AI to rewrite the file. This edits it
 * directly and regenerates everything derived from it on save.
 *
 * The rows are written back through the same parser the card loads with, so an
 * edit that would not load again is refused while it is still on screen.
 */

const LEAF_DEFAULT: Record<string, string> = { 文本: '', 数值: '0', 布尔: 'false', 枚举: '' };

function blankRow(): VariableRow {
  return { path: '/新变量', type: '文本', owner: '模型', default: '' };
}

/** The editor keeps every field as text; it is converted once, on save. */
interface DraftRow {
  path: string; type: string; owner: string; value: string;
  min: string; max: string; values: string; limit: string; element: string; when: string; note: string;
}

function toDraft(row: VariableRow): DraftRow {
  return {
    path: row.path, type: row.type, owner: row.owner,
    value: row.default === undefined ? '' : String(row.default),
    min: row.range ? String(row.range[0]) : '', max: row.range ? String(row.range[1]) : '',
    values: row.values?.join(', ') ?? '', limit: row.limit ? String(row.limit) : '',
    element: row.element ?? '文本', when: row.when ?? '', note: row.note ?? '',
  };
}

function fromDraft(draft: DraftRow): VariableRow {
  const row: VariableRow = { path: draft.path.trim(), type: draft.type as VariableRow['type'], owner: draft.owner as VariableRow['owner'] };
  if (isLeaf(row)) {
    const raw = draft.value;
    row.default = row.type === '数值' ? Number(raw || 0) : row.type === '布尔' ? raw === 'true' : raw;
  }
  if (row.type === '数值' && draft.min.trim() && draft.max.trim()) row.range = [Number(draft.min), Number(draft.max)];
  if (row.type === '枚举') row.values = draft.values.split(/[,，]/).map(value => value.trim()).filter(Boolean);
  if ((row.type === '记录' || row.type === '列表') && draft.limit.trim()) row.limit = Number(draft.limit);
  if (row.type === '列表') row.element = (draft.element || '文本') as VariableRow['element'];
  if (draft.when.trim()) row.when = draft.when.trim();
  if (draft.note.trim()) row.note = draft.note.trim();
  return row;
}

/**
 * The table requires every parent of a path to be a row of its own. Adding
 * `/主角/生命` to an empty table would otherwise be refused for a reason the
 * user did not cause, so the missing containers are filled in on save.
 */
export function withParentRows(rows: VariableRow[]): VariableRow[] {
  const known = new Set(rows.map(row => row.path));
  const added: VariableRow[] = [];
  for (const row of rows) {
    const segments = row.path.split('/').slice(1);
    for (let depth = 1; depth < segments.length; depth++) {
      const path = `/${segments.slice(0, depth).join('/')}`;
      // A placeholder never gets a row of its own: a record's object items and a
      // list's object elements are described by the fields written under them.
      if (segments[depth - 1] === KEY_PLACEHOLDER || segments[depth - 1] === ELEMENT_PLACEHOLDER) continue;
      if (known.has(path)) continue;
      known.add(path);
      // What follows says what the container is: arbitrary keys make a 记录, elements a 列表.
      const child = segments[depth];
      added.push({ path, type: child === KEY_PLACEHOLDER ? '记录' : child === ELEMENT_PLACEHOLDER ? '列表' : '对象', owner: row.owner, ...(child === ELEMENT_PLACEHOLDER ? { element: '对象' as const } : {}) });
    }
  }
  if (!added.length) return rows;
  // Parents must come before their children, and a shorter path is always a parent.
  return [...rows, ...added].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
}

export function VariableTableEditor({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { api, t, run } = useApp();
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [source, setSource] = useState<'authored' | 'derived' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.readCardVariableRows(projectId).then(read => {
      if (!alive) return;
      setSource(read.source); setNote(read.note ?? ''); setError(read.error ?? '');
      setRows(read.rows.length ? read.rows.map(toDraft) : [toDraft(blankRow())]);
    }, () => { if (alive) { setRows([toDraft(blankRow())]); setError(t('The table could not be read.', '变量表读不出来。')); } });
    return () => { alive = false; };
  }, [api, projectId, t]);

  function update(index: number, changes: Partial<DraftRow>) {
    setRows(current => current?.map((row, position) => position === index ? { ...row, ...changes, ...(changes.type && changes.type !== row.type ? { value: LEAF_DEFAULT[changes.type] ?? '' } : {}) } : row) ?? null);
    setError('');
  }

  async function save() {
    if (!rows?.length) return;
    setSaving(true); setError('');
    try {
      const table = { version: 1 as const, ...(note.trim() ? { note: note.trim() } : {}), rows: withParentRows(rows.map(fromDraft)) };
      const result = await api.saveCardVariableRows(projectId, table);
      await run(async () => result, `${t('Saved', '已保存')} · ${result.rows} ${t('rows', '行')} · ${t('regenerated', '已重新生成')} ${result.written.length + result.created.length}`);
      onClose();
    } catch (failure) {
      // The parser's message names the row and what is wrong with it.
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setSaving(false); }
  }

  return <Modal title={t('Variable table', '变量表')} className="variable-table-modal" onClose={() => { if (!saving) onClose(); }}>
    <p className="modal-intro">{t('Every variable this card has. The Zod schema, the initial values, the variable list and the front-end references are all generated from these rows, and saving regenerates them.', '这张卡的全部变量。Zod 结构、初始变量、变量列表和前端引用都由这些行生成，保存时会一并重新生成。')}</p>
    {source === 'derived' && <p className="variable-table-derived">{t('These rows were worked out from an imported card. Saving writes them as this card’s own table.', '这些行是从导入的卡推导出来的。保存后就成为这张卡自己的变量表。')}</p>}
    {rows === null ? <p className="muted"><LoaderCircle size={14} className="spinning" /> {t('Reading…', '读取中…')}</p> : <>
      <div className="variable-table-scroll">
        <table className="variable-table-grid">
          <thead><tr>
            <th>{t('Path', '路径')}</th><th>{t('Type', '类型')}</th><th>{t('Default / values', '默认 / 取值')}</th>
            <th>{t('Owner', '维护者')}</th><th>{t('When', '更新时机')}</th><th>{t('Note', '说明')}</th><th />
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index}>
              <td><input value={row.path} spellCheck={false} aria-label={`${t('Path', '路径')} ${index + 1}`} onChange={event => update(index, { path: event.target.value })} placeholder="/主角/生命" /></td>
              <td><select value={row.type} aria-label={`${t('Type', '类型')} ${index + 1}`} onChange={event => update(index, { type: event.target.value })}>{VARIABLE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></td>
              <td>
                {row.type === '布尔' ? <select value={row.value} aria-label={`${t('Default', '默认')} ${index + 1}`} onChange={event => update(index, { value: event.target.value })}><option value="false">false</option><option value="true">true</option></select>
                  : row.type === '枚举' ? <input value={row.values} aria-label={`${t('Values', '取值')} ${index + 1}`} onChange={event => update(index, { values: event.target.value })} placeholder={t('one, two, three', '选项一, 选项二')} />
                  : row.type === '数值' ? <span className="variable-table-number">
                      <input value={row.value} aria-label={`${t('Default', '默认')} ${index + 1}`} onChange={event => update(index, { value: event.target.value })} placeholder="0" />
                      <input value={row.min} aria-label={`${t('Minimum', '最小值')} ${index + 1}`} onChange={event => update(index, { min: event.target.value })} placeholder={t('min', '最小')} />
                      <input value={row.max} aria-label={`${t('Maximum', '最大值')} ${index + 1}`} onChange={event => update(index, { max: event.target.value })} placeholder={t('max', '最大')} />
                    </span>
                  : row.type === '列表' ? <span className="variable-table-number">
                      <select value={row.element} aria-label={`${t('Element', '元素')} ${index + 1}`} onChange={event => update(index, { element: event.target.value })}>{VARIABLE_ELEMENTS.map(element => <option key={element} value={element}>{element}</option>)}</select>
                      <input value={row.limit} aria-label={`${t('Limit', '上限')} ${index + 1}`} onChange={event => update(index, { limit: event.target.value })} placeholder={t('limit', '上限')} />
                    </span>
                  : row.type === '记录' ? <input value={row.limit} aria-label={`${t('Limit', '上限')} ${index + 1}`} onChange={event => update(index, { limit: event.target.value })} placeholder={t('limit', '上限')} />
                  : <input value={row.value} aria-label={`${t('Default', '默认')} ${index + 1}`} onChange={event => update(index, { value: event.target.value })} />}
              </td>
              <td><select value={row.owner} aria-label={`${t('Owner', '维护者')} ${index + 1}`} onChange={event => update(index, { owner: event.target.value })}>{VARIABLE_OWNERS.map(owner => <option key={owner} value={owner}>{owner}</option>)}</select></td>
              <td><input value={row.when} aria-label={`${t('When', '更新时机')} ${index + 1}`} onChange={event => update(index, { when: event.target.value })} /></td>
              <td><input value={row.note} aria-label={`${t('Note', '说明')} ${index + 1}`} onChange={event => update(index, { note: event.target.value })} /></td>
              <td><button type="button" className="cs-icon-button" aria-label={`${t('Remove row', '删除这一行')} ${index + 1}`} disabled={rows.length < 2} onClick={() => { setRows(current => current!.filter((_, position) => position !== index)); setError(''); }}><Trash2 size={13} /></button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="variable-table-actions">
        <button type="button" className="cs-btn is-small" onClick={() => setRows(current => [...(current ?? []), toDraft(blankRow())])}><Plus size={13} />{t('Add a row', '加一行')}</button>
        <small>{t('Use', '用')} <code>{KEY_PLACEHOLDER}</code> {t('for any key of a record, and', '表示记录的任意键，')}<code>{ELEMENT_PLACEHOLDER}</code> {t('for any element of a list.', '表示列表的任意元素。')}</small>
      </div>
      <label className="variable-table-note"><span>{t('Table note (optional)', '表格备注（可选）')}</span><input value={note} onChange={event => setNote(event.target.value)} /></label>
      {error && <p className="variable-table-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button" disabled={saving} onClick={onClose}>{t('Cancel', '取消')}</button>
        <button type="button" className="button primary" disabled={saving} onClick={() => void save()}>{saving ? t('Saving…', '保存中…') : t('Save and regenerate', '保存并重新生成')}</button>
      </div>
    </>}
  </Modal>;
}
