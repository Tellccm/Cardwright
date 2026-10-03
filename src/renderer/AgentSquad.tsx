import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Clock3, GitBranch, Plus, Send, ShieldCheck, Square, Users, X, Folder } from 'lucide-react';
import type { Task } from '../shared/types';
import { useApp } from './context';
import { Field, IconButton } from './primitives';
import { SquadMemberCard } from './SquadMemberCard';
import { memberInProgress, memberState } from '../shared/squad-view';
import './squad.css';

const nameOf = (task: Task) => task.agentName || task.title;

export function AgentSquad({ task, members, onClose, onCreate, focusOnOpen = true }: { task: Task; members: Task[]; onClose: () => void; onCreate: () => void; focusOnOpen?: boolean }) {
  const { data, api, t, run, navigate } = useApp();
  const [expanded, setExpanded] = useState<string | null>(() => members.find(memberInProgress)?.id || null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [followup, setFollowup] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const panel = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  const active = members.filter(memberInProgress); const returned = members.filter(member => !memberInProgress(member));
  const waiting = active.filter(member => data.approvals.some(item => item.taskId === member.id) || data.interactions.some(item => item.taskId === member.id));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = focusOnOpen ? requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus()) : null;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) { event.preventDefault(); event.stopPropagation(); close.current(); } };
    document.addEventListener('keydown', key);
    return () => { if (frame !== null) cancelAnimationFrame(frame); document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (!active.length) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active.length]);
  function roleName(member: Task) {
    const role = member.role || 'executor';
    return data.ecosystem.roles.find(item => item.id === role)?.name || role;
  }
  function duration(member: Task) {
    const started = Date.parse(member.startedAt || member.createdAt);
    const ended = memberInProgress(member) ? now : Date.parse(member.completedAt || member.updatedAt);
    const seconds = Math.max(0, Math.floor((ended - started) / 1000));
    if (!Number.isFinite(seconds)) return '—';
    return seconds >= 3600 ? `${Math.floor(seconds / 3600)}${t('h', '时')} ${Math.floor(seconds % 3600 / 60)}${t('m', '分')}` : seconds >= 60 ? `${Math.floor(seconds / 60)}${t('m', '分')} ${seconds % 60}${t('s', '秒')}` : `${seconds}${t('s', '秒')}`;
  }
  async function resume(member: Task) {
    if (!followup.trim() || busy) return; setBusy(member.id);
    const success = await run(async () => { await api.resumeAgent(member.id, followup.trim()); return true; });
    if (success) { setResumeId(null); setFollowup(''); setExpanded(member.id); } setBusy(null);
  }
  function memberRow(member: Task) {
    const current = memberState(member, { approval: data.approvals.some(item => item.taskId === member.id), question: data.interactions.some(item => item.taskId === member.id) }, t);
    const working = memberInProgress(member); const isExpanded = expanded === member.id;
    const result = [...member.messages].reverse().find(message => message.role === 'assistant' && message.text.trim())?.text;
    const tool = [...member.tools].reverse().find(item => item.status === 'running' || item.status === 'waiting');
    return <SquadMemberCard key={member.id} member={member} name={nameOf(member)} kind={roleName(member)} state={current} expanded={isExpanded} onToggle={() => setExpanded(isExpanded ? null : member.id)}
      brief={member.assignedTask || member.messages.find(message => message.role === 'user')?.text || member.title}
      meta={<><span title={member.startedAt ? t('Current run duration', '本次用时') : t('Total elapsed time', '累计历时')}><Clock3 size={12} />{duration(member)}</span>{member.worktree && <span title={member.worktree.branch}><GitBranch size={12} />{t('Isolated worktree', '独立工作树')}</span>}{member.sharedReadOnly && <span title={t('This agent can inspect the shared folder. Changes are handled by the lead.', '此成员只读取共享目录，由主代理负责修改。')}><ShieldCheck size={12} />{t('Read only', '共享目录 · 只读')}</span>}{member.readOnly && !member.sharedReadOnly && <span title={t('This member only reads; it cannot change files.', '此成员只读，不能修改文件。')}><ShieldCheck size={12} />{t('Read only', '只读')}</span>}{member.sharedWorkspace && <span title={t('This member edits the shared project folder directly; the lead gives each member separate files.', '此成员直接修改共享目录，主代理为每位成员分配不同的文件。')}><Folder size={12} />{t('Shared folder', '共享目录 · 可写')}</span>}{(member.activationCount || 1) > 1 && <span>{t('Run', '第')} {member.activationCount} {t('', '次执行')}</span>}</>}>
      {working && tool && <p className="squad-live-tool"><TerminalLabel name={tool.name} />{t('Executing', '正在执行')}</p>}
      {member.error && <p className="squad-member-error" role="status">{member.error}</p>}
      <div className="squad-result"><h4>{working ? t('Latest update', '最新进展') : t('Returned result', '返回结果')}</h4>{result ? <p>{result}</p> : <p className="muted">{working ? t('The agent will report progress here.', '成员的工作进展会显示在这里。') : t('No text result was returned. Open the task to inspect its execution log.', '尚无文字结果，可打开任务查看执行记录。')}</p>}</div>
      <div className="squad-member-actions"><button type="button" className="text-button" onClick={() => navigate(member.id)}><ArrowUpRight size={14} />{t('Open task', '打开任务')}</button>{working ? <button type="button" className="text-button squad-stop" disabled={!!busy} onClick={() => { setBusy(member.id); void run(() => api.cancelTask(member.id)).finally(() => setBusy(null)); }}><Square size={12} />{busy === member.id ? t('Stopping…', '正在停止…') : t('Stop', '停止')}</button> : <button type="button" className="text-button" disabled={!!busy} onClick={() => { setResumeId(resumeId === member.id ? null : member.id); setFollowup(''); }}><RefreshIcon />{t('Reopen with a task', '再分配任务')}</button>}</div>
      {resumeId === member.id && !working && <form className="squad-resume" onSubmit={event => { event.preventDefault(); void resume(member); }}><Field label={t('Next assignment', '新的任务')}><textarea autoFocus rows={3} value={followup} maxLength={100000} required placeholder={t('Tell this agent what to do next…', '告诉这位成员接下来要做什么…')} onChange={event => setFollowup(event.target.value)} /></Field><div><button type="button" className="button" disabled={!!busy} onClick={() => setResumeId(null)}>{t('Cancel', '取消')}</button><button className="button primary" disabled={!!busy || !followup.trim()}><Send size={13} />{busy === member.id ? t('Starting…', '启动中…') : t('Start new run', '重新启动')}</button></div></form>}
    </SquadMemberCard>;
  }
  return <aside className="squad-panel" ref={panel} aria-labelledby="squad-panel-heading">
    <header className="squad-panel-header"><h2 id="squad-panel-heading"><Users size={18} />{t('Agent squad', '子代理小队')}</h2><IconButton label={t('Close agent squad', '关闭子代理小队')} onClick={onClose}><X size={18} /></IconButton></header>
    <div className="squad-overview"><div className="squad-overview-line"><strong>{t('Led by the main conversation', '主对话统筹，成员各司其职')}</strong>{task.thinking === 'ultra' && <span className="squad-ultra">Ultra · max</span>}</div><p>{t('Members return their results and close after each assignment. The lead can reopen a member or assemble a new squad when needed.', '成员完成任务后返回结果并关闭。需要时，主代理会重新启用成员或组建新的小队。')}</p><div className="squad-counts" role="status"><span><i className={`status-dot ${active.length ? 'running' : 'idle'}`} />{active.length} {t('active', '位工作中')}</span><span><Check size={12} />{returned.length} {t('closed', '位已关闭')}</span>{waiting.length > 0 && <span className="squad-needs-input">{waiting.length} {t('need input', '位等待回应')}</span>}</div></div>
    <div className="squad-roster"><section aria-labelledby="squad-active-heading"><h3 id="squad-active-heading">{t('Current members', '当前成员')}<span>{active.length}</span></h3>{active.length ? active.map(memberRow) : <div className="squad-empty"><Users size={24} /><strong>{members.length ? t('Everyone has returned', '小队成员已全部返回') : t('Ready to assemble', '等待组建小队')}</strong><p>{members.length ? t('Results are kept below. Closed members do not keep running in the background.', '结果保存在下方。已关闭的成员不会继续在后台运行。') : t('In Ultra, the lead assigns focused work to named members when the task benefits from collaboration.', '使用 Ultra 时，主代理会按任务需要分工，并为成员取一个合适的中文名。')}</p></div>}</section>
      {returned.length > 0 && <section className="squad-history"><button type="button" className="squad-history-heading" aria-expanded={historyOpen} aria-controls="squad-history" onClick={() => setHistoryOpen(!historyOpen)}><span>{t('Returned members', '已返回成员')}<b>{returned.length}</b></span><ChevronDown size={15} /></button>{historyOpen && <div id="squad-history">{returned.map(memberRow)}</div>}</section>}
    </div><footer className="squad-panel-footer"><button type="button" className="button" onClick={onCreate}><Plus size={15} />{t('Assign another agent', '手动分配成员')}</button></footer>
  </aside>;
}

function TerminalLabel({ name }: { name: string }) { return <code>{name}</code>; }
function RefreshIcon() { return <ArrowUpRight size={14} />; }
