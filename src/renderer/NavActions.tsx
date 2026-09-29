import { useState, type ReactNode } from 'react';
import { Archive, ChevronRight, FileDown, FolderOpen, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useApp } from './context';
import { Field, Modal } from './primitives';
import { ContextMenu, type ContextAction, type MenuPosition } from './ContextMenu';

type Target = { kind: 'project' | 'task'; id: string };

/** Shared project/task context menus and rename dialog for the channel strip and task column. */
export function useNavActions({ selectedId, onNewTask }: { selectedId: string | null; onNewTask: (projectId: string) => void }): { openMenu: (target: Target, element: HTMLElement, point?: { x: number; y: number }) => void; element: ReactNode } {
  const { data, api, t, run, navigate } = useApp();
  const [menu, setMenu] = useState<(Target & { position: MenuPosition }) | null>(null);
  const [rename, setRename] = useState<(Target & { value: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ ids: string[]; title: string } | null>(null);
  function openMenu(target: Target, element: HTMLElement, point?: { x: number; y: number }) {
    const rect = element.getBoundingClientRect();
    setMenu({ ...target, position: { x: point?.x ?? rect.right, y: point?.y ?? rect.bottom + 4, origin: element } });
  }
  const project = menu?.kind === 'project' ? data.projects.find(item => item.id === menu.id) : undefined;
  const task = menu?.kind === 'task' ? data.tasks.find(item => item.id === menu.id) : undefined;
  const actions: ContextAction[] = project ? [
    { label: t('New task', '新建任务'), icon: <Plus size={15} />, action: () => onNewTask(project.id) },
    { label: project.collapsed ? t('Expand project', '展开项目') : t('Collapse project', '折叠项目'), icon: <ChevronRight size={15} />, action: () => void run(() => api.updateProject(project.id, { collapsed: !project.collapsed })) },
    { label: t('Rename project', '重命名项目'), icon: <Pencil size={15} />, action: () => setRename({ kind: 'project', id: project.id, value: project.name }) },
    { label: project.pinned ? t('Unpin project', '取消置顶项目') : t('Pin project', '置顶项目'), icon: project.pinned ? <PinOff size={15} /> : <Pin size={15} />, action: () => void run(() => api.updateProject(project.id, { pinned: !project.pinned })) },
    { label: t('Open folder', '打开文件夹'), icon: <FolderOpen size={15} />, separator: true, action: () => void run(() => api.openPath(project.path)) },
  ] : task ? [
    { label: t('Open task', '打开任务'), icon: <ChevronRight size={15} />, action: () => navigate(task.id) },
    { label: t('Rename task', '重命名任务'), icon: <Pencil size={15} />, action: () => setRename({ kind: 'task', id: task.id, value: task.title }) },
    { label: task.pinned ? t('Unpin task', '取消置顶任务') : t('Pin task', '置顶任务'), icon: task.pinned ? <PinOff size={15} /> : <Pin size={15} />, action: () => void run(() => api.updateTask(task.id, { pinned: !task.pinned })) },
    { label: t('Open working folder', '打开工作目录'), icon: <FolderOpen size={15} />, action: () => void run(() => api.openPath(task.cwd)) },
    { label: t('Archive task', '归档任务'), icon: <Archive size={15} />, separator: true, disabled: ['running', 'waiting', 'queued'].includes(task.status), action: () => void run(async () => { await api.updateTask(task.id, { archived: true }); if (selectedId === task.id) navigate(null); }) },
    { label: t('Export as Markdown', '导出为 Markdown'), icon: <FileDown size={15} />, action: () => void run(async () => { const path = await api.exportTranscript(task.id); if (path) await api.openPath(path); }) },
    { label: t('Delete task', '删除任务'), icon: <Trash2 size={15} />, disabled: ['running', 'waiting', 'queued'].includes(task.status), action: () => setConfirm({ ids: [task.id], title: task.title }) },
  ] : [];
  const element = <>
    {confirm && <DeleteTasks ids={confirm.ids} title={confirm.title} onClose={() => setConfirm(null)} onDone={ids => { setConfirm(null); if (selectedId && ids.includes(selectedId)) navigate(null); }} />}
    {menu && actions.length > 0 && <ContextMenu position={menu.position} actions={actions} label={menu.kind === 'project' ? t('Project actions', '项目操作') : t('Task actions', '任务操作')} onClose={() => setMenu(null)} />}
    {rename && <Modal title={rename.kind === 'project' ? t('Rename project', '重命名项目') : t('Rename task', '重命名任务')} className="small-modal" onClose={() => { if (!saving) setRename(null); }}>
      <form onSubmit={event => { event.preventDefault(); setSaving(true); void run(async () => { if (rename.kind === 'project') await api.updateProject(rename.id, { name: rename.value.trim() }); else await api.updateTask(rename.id, { title: rename.value.trim() }); setRename(null); }).finally(() => setSaving(false)); }}>
        <Field label={t('Name', '名称')}><input autoFocus required maxLength={160} value={rename.value} onChange={event => setRename({ ...rename, value: event.target.value })} /></Field>
        <div className="modal-actions"><button type="button" className="button" disabled={saving} onClick={() => setRename(null)}>{t('Cancel', '取消')}</button><button className="button primary" disabled={saving || !rename.value.trim()}>{saving ? t('Saving…', '保存中…') : t('Save', '保存')}</button></div>
      </form>
    </Modal>}
  </>;
  return { openMenu, element };
}

/** Keyboard access to the same menu: Shift+F10 or the context-menu key. */
export const isMenuKey = (event: React.KeyboardEvent) => (event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu';

/**
 * 删除任务 — one confirmation that names everything going with it.
 *
 * Deleting is permanent: there is no recycle bin, because archiving already
 * covers "put it aside". Project files, project memory and daily usage totals
 * are unaffected.
 */
export function DeleteTasks({ ids, title, kind = 'task', onClose, onDone }: { ids: string[]; title?: string; kind?: 'task' | 'conversation'; onClose: () => void; onDone: (ids: string[]) => void }) {
  const { data, api, t, run } = useApp();
  const [busy, setBusy] = useState(false);
  const wanted = new Set(ids);
  const leads = data.tasks.filter(task => wanted.has(task.id));
  const squads = new Set(leads.map(task => task.squadId).filter(Boolean));
  const extra = data.tasks.filter(task => !wanted.has(task.id) && ((task.parentId && wanted.has(task.parentId)) || (task.squadId && squads.has(task.squadId))));
  const worktrees = [...leads, ...extra].filter(task => task.worktree);
  const conversation = kind === 'conversation';
  return <Modal title={ids.length > 1 ? t('Delete these?', '删除这些？') : conversation ? t('Delete this conversation?', '删除这个对话？') : t('Delete this task?', '删除这个任务？')} className="small-modal" onClose={() => { if (!busy) onClose(); }}>
    <p className="modal-intro">{ids.length > 1
      ? `${t('These', '将删除')} ${leads.length} ${conversation ? t('conversations and everything saved with them will be removed.', '个对话，以及它们保存的全部记录。') : t('tasks and everything saved with them will be removed.', '个任务，以及它们保存的全部记录。')}`
      : `${t('“', '「')}${title || ''}${t('” and everything saved with it will be removed.', '」以及它保存的全部记录都会删除。')}`}</p>
    <ul className="delete-summary">
      <li>{t('Conversation, tool records, versions and checkpoints', '对话、工具记录、对话版本与检查点')}</li>
      {extra.length > 0 && <li>{extra.length} {t('sub-tasks and squad members', '个子任务与小队成员')}</li>}
      {worktrees.length > 0 && <li>{worktrees.length} {t('isolated worktrees', '个独立工作目录')}</li>}
      <li className="delete-keeps">{conversation
        ? t('Kept: component files already written, dispatches, change orders, and daily token totals.', '保留：已经写进卡项目的组件文件、派单、改动单，以及每天的 Token 用量统计。')
        : t('Kept: your project files, project memory, and daily token totals.', '保留：项目文件、项目记忆，以及每天的 Token 用量统计。')}</li>
    </ul>
    <p className="delete-warning">{t('This cannot be undone.', '删除后无法恢复。')}</p>
    <div className="modal-actions">
      <button type="button" className="button" disabled={busy} onClick={onClose}>{t('Cancel', '取消')}</button>
      <button type="button" className="button danger" disabled={busy} onClick={() => { setBusy(true); void run(() => api.deleteTasks(ids), t('Deleted', '已删除')).then(result => { if (result) onDone([...ids, ...extra.map(task => task.id)]); }).finally(() => setBusy(false)); }}>{busy ? t('Deleting…', '删除中…') : t('Delete', '删除')}</button>
    </div>
  </Modal>;
}
