import { useEffect, useState } from 'react';
import { ChevronDown, Download, Sparkles, Trash2 } from 'lucide-react';
import type { JailbreakChoice, JailbreakPackSummary, PresetImportEntry } from '../shared/jailbreak';
import { useApp } from './context';
import { IconButton, MenuItem, Modal, Popover } from './primitives';

/**
 * 破限 — the toggle beside the composer and the picker behind it.
 *
 * The button only names the pack in use. The text itself never reaches the
 * view: everything shown here is a name, a role and a length.
 */
export function JailbreakPicker({ value, onChange, disabled }: { value?: JailbreakChoice; onChange: (next: JailbreakChoice | null) => void; disabled?: boolean }) {
  const { api, t, run } = useApp();
  const [packs, setPacks] = useState<JailbreakPackSummary[]>([]);
  const [importing, setImporting] = useState<{ name: string; entries: PresetImportEntry[] } | null>(null);

  async function refresh() { const list = await run(() => api.listJailbreakPacks()); if (list) setPacks(list); }
  useEffect(() => { void refresh(); }, []);

  const active = value ? packs.find(pack => pack.id === value.pack) : undefined;
  const label = active ? active.name : value ? t('Unavailable', '已失效') : t('Off', '未开');

  async function beginImport() {
    const read = await run(() => api.readJailbreakPreset());
    if (read) setImporting(read);
  }

  return <>
    <Popover label={t('破限', '破限')} className={`jailbreak-picker ${value ? 'enabled' : ''}`} trigger={<>
      <small className="module-label">{t('Framing', '破限')}</small>
      <span className="module-value"><Sparkles size={14} /><span>{label}</span><ChevronDown size={12} /></span>
    </>}>{close => <>
        <div className="menu-heading">{t('破限', '破限')}</div>
        <MenuItem selected={!value} disabled={disabled} onClick={() => { onChange(null); close(); }}>
          <span className="menu-stacked"><span>{t('Off', '关闭')}</span><small>{t('Requests carry nothing extra.', '请求不带任何附加提示词。')}</small></span>
        </MenuItem>
        {packs.map(pack => <MenuItem key={pack.id} selected={value?.pack === pack.id} disabled={disabled} onClick={() => { onChange({ pack: pack.id }); close(); }}>
          <span className="menu-stacked"><span>{pack.name}</span><small>{pack.builtIn ? t('Built in', '内置') : t('Imported', '导入')} · {pack.entries} {t('entries', '条')}</small></span>
          {!pack.builtIn && <IconButton label={`${t('Delete', '删除')} ${pack.name}`} onClick={() => { void run(async () => { await api.removeJailbreakPack(pack.id); if (value?.pack === pack.id) onChange(null); await refresh(); }); }}><Trash2 size={14} /></IconButton>}
        </MenuItem>)}
        <div className="menu-divider" />
        <MenuItem onClick={() => { close(); void beginImport(); }}><Download size={15} />{t('Import from a SillyTavern preset…', '从酒馆预设导入…')}</MenuItem>
        <div className="menu-footnote">{disabled ? t('Stop this task before changing 破限.', '停止这个任务后才能改破限。') : t('Sent ahead of every request this task makes. Switching rebuilds the prompt cache once.', '随这个任务的每次请求一起发送。切换会让缓存重建一次。')}</div>
      </>}</Popover>
    {importing && <ImportDialog read={importing} onClose={() => setImporting(null)} onSaved={async choice => { setImporting(null); await refresh(); onChange(choice); }} />}
  </>;
}

const PLACEMENTS: Array<{ id: PresetImportEntry['placement']; en: string; zh: string; note: { en: string; zh: string } }> = [
  { id: 'system', en: 'Ahead of the system prompt', zh: '系统提示词最前', note: { en: 'Placed before Cardwright’s own prompt.', zh: '排在 Cardwright 自己的提示词之前。' } },
  { id: 'opening', en: 'Opening exchange', zh: '开场对话', note: { en: 'Inserted at the head of the conversation.', zh: '放在聊天记录的最前面。' } },
  { id: 'tail', en: 'After the newest message', zh: '最新消息之后', note: { en: 'Appended to the newest user message.', zh: '附在最新一条用户消息后面。' } },
];

function ImportDialog({ read, onClose, onSaved }: { read: { name: string; entries: PresetImportEntry[] }; onClose: () => void; onSaved: (choice: JailbreakChoice) => void | Promise<void> }) {
  const { api, t, run } = useApp();
  const [name, setName] = useState(read.name.slice(0, 120));
  const [chosen, setChosen] = useState<string[]>(() => read.entries.filter(entry => entry.enabled).map(entry => entry.id));
  const [busy, setBusy] = useState(false);
  const selected = read.entries.filter(entry => chosen.includes(entry.id));
  const macros = [...new Set(selected.flatMap(entry => entry.unresolved))];

  async function save() {
    if (!selected.length || !name.trim()) return;
    setBusy(true);
    const pack = {
      id: `pack-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      name: name.trim(),
      entries: selected.map(entry => ({ id: entry.id, name: entry.name, role: entry.role, placement: entry.placement, content: entry.content })),
    };
    const saved = await run(() => api.saveJailbreakPack(pack), t('破限 imported', '破限已导入'));
    setBusy(false);
    if (saved) await onSaved({ pack: saved.id });
  }

  return <Modal title={t('Import 破限 from a preset', '从酒馆预设导入破限')} onClose={() => { if (!busy) onClose(); }} className="jailbreak-import-modal">
    <p className="modal-intro">{t('Pick the entries to send. Cardwright forwards them exactly as written; it never rewrites them.', '勾选要发送的条目。Cardwright 原样转发，不改写内容。')}</p>
    <fieldset disabled={busy}>
      <label className="field"><span>{t('Name', '名称')}</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
      {PLACEMENTS.map(group => {
        const entries = read.entries.filter(entry => entry.placement === group.id);
        if (!entries.length) return null;
        return <section key={group.id} className="jailbreak-import-group">
          <h4>{t(group.en, group.zh)}<small>{t(group.note.en, group.note.zh)}</small></h4>
          {entries.map(entry => <label key={entry.id} className="jailbreak-import-entry">
            <input type="checkbox" checked={chosen.includes(entry.id)} onChange={event => setChosen(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} />
            <span><strong>{entry.name}</strong><small>{entry.role} · {entry.content.length} {t('characters', '字')}{entry.enabled ? '' : t(' · off in the preset', ' · 预设里是关的')}</small></span>
          </label>)}
        </section>;
      })}
      {macros.length > 0 && <p className="jailbreak-import-macros">{t('These macros are passed through as written, because Cardwright cannot resolve them:', '下面这些宏 Cardwright 解析不了，会原样发出去：')} <code>{macros.join(' ')}</code></p>}
    </fieldset>
    <div className="modal-actions">
      <button type="button" className="button" onClick={onClose} disabled={busy}>{t('Cancel', '取消')}</button>
      <button type="button" className="button primary" onClick={() => void save()} disabled={busy || !selected.length || !name.trim()}>{t('Import', '导入')} ({selected.length})</button>
    </div>
  </Modal>;
}
