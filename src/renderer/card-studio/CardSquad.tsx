import { useLayoutEffect, useMemo, useState } from 'react';
import { ChevronRight, Square, Users } from 'lucide-react';
import { useApp } from '../context';
import { groupConversation, ToolRecord } from '../Conversation';
import { SquadMemberCard } from '../SquadMemberCard';
import { memberInProgress, memberState } from '../../shared/squad-view';
import { netStatusText } from '../../shared/net-status';
import { cardMemberLabel, cardMemberRole } from '../../shared/card-studio/squad';
import { memberSummary, memberWrites } from '../../shared/card-studio/view';
import { stripMarkers } from '../../shared/card-studio/markers';
import type { CardMemberRole, CardProjectView } from '../../shared/card-studio/types';
import type { Task } from '../../shared/types';
import { Markdown } from './studio-markdown';

/** What each kind of member does, in the line under its name: [English, Chinese]. */
const KIND_LINE: Record<CardMemberRole, readonly [string, string]> = {
  researcher: ['Read only · hands back sourced points', '只读 · 交回带出处的要点'],
  writer: ['Writes only the components it was given', '只写分给它的组件'],
};

/** The clock the members' 排队 and 冷却 countdowns read. It ticks only while one of them has a time to count down. */
function useCountdownClock(members: readonly Task[]): number {
  const untils = members.map(member => member.net?.until ?? 0).filter(Boolean).join(',');
  const [now, setNow] = useState(() => Date.now());
  // A layout effect, so the clock is corrected before the first frame with a countdown is painted (see useNetStatusText).
  useLayoutEffect(() => {
    if (!untils) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [untils]);
  return now;
}

/** What one member did, read-only and in place: the studio has no page of its own for a member (spec Q22). */
function MemberTranscript({ member }: { member: Task }) {
  const { t } = useApp();
  const turns = useMemo(() => groupConversation(member), [member.messages, member.tools]);
  if (!turns.length) return <p className="cs-note">{t('Nothing yet.', '还没有内容。')}</p>;
  return <div className="cs-process-body">{turns.map(turn => <div key={turn.id} className="cs-squad-turn">
    {turn.user && <p className="cs-squad-task">{turn.user.text}</p>}
    {turn.entries.map(entry => entry.type === 'tool' ? <ToolRecord key={entry.item.id} tool={entry.item} />
      : entry.item.role === 'assistant' && entry.item.text.trim() ? <div key={entry.item.id} className="cs-md"><Markdown text={stripMarkers(entry.item.text).text} /></div> : null)}
  </div>)}</div>;
}

function SquadArea({ members, card }: { members: Task[]; card: CardProjectView }) {
  const { api, t, run } = useApp();
  const now = useCountdownClock(members);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const working = members.filter(memberInProgress).length;
  return <section className="cs-squad-area" aria-label={t('Squad', '小队')}>
    <header><Users size={13} /><span>{t('Squad', '小队')}</span><em>{members.length}</em>{working > 0 && <small>{t(`${working} working`, `${working} 个在做`)}</small>}</header>
    {members.map(member => {
      const active = memberInProgress(member);
      const writes = memberWrites(member, card.path);
      const summary = memberSummary(member);
      const net = netStatusText(member.net, now, t);
      const [kindEnglish, kindChinese] = KIND_LINE[cardMemberRole(member)];
      return <SquadMemberCard key={member.id} member={member} name={cardMemberLabel(member)} kind={t(kindEnglish, kindChinese)} state={memberState(member, { approval: false, question: false }, t)}
        expanded={expanded === member.id} onToggle={() => setExpanded(expanded === member.id ? null : member.id)}
        brief={member.assignedTask || member.title}
        meta={<>{net && <span className="cs-squad-net">{net}</span>}{writes.length > 0 && <span>{t(`${writes.length} ${writes.length === 1 ? 'component' : 'components'} written`, `写了 ${writes.length} 个组件`)}</span>}</>}>
        {member.error && <p className="squad-member-error" role="status">{member.error}</p>}
        {writes.length > 0 && <ul className="cs-squad-writes">{writes.map(write => <li key={write.name}><b>{write.name}</b><small>{write.paths.join(' · ')}</small></li>)}</ul>}
        <div className="squad-result"><h4>{active ? t('Latest', '最新进展') : t('Returned', '交回的结果')}</h4>{summary ? <p>{summary}</p> : <p className="muted">{active ? t('Working…', '正在做…') : t('No text came back.', '没有交回文字。')}</p>}</div>
        <details className="cs-process"><summary><ChevronRight size={13} />{t('Work log', '处理过程')}</summary><MemberTranscript member={member} /></details>
        {active && <div className="squad-member-actions"><button type="button" className="text-button squad-stop" disabled={stopping === member.id} onClick={() => { setStopping(member.id); void run(() => api.cancelTask(member.id)).finally(() => setStopping(null)); }}><Square size={12} />{stopping === member.id ? t('Stopping…', '正在停止…') : t('Stop this member', '停止这个成员')}</button></div>}
      </SquadMemberCard>;
    })}
  </section>;
}

/** The squad of one turn (spec §6, Q22): each member's kind and name, state, network state, the files it wrote and what it returned; each can be stopped on its own. */
export function CardSquad({ members, card }: { members: Task[]; card: CardProjectView }) {
  return members.length ? <SquadArea members={members} card={card} /> : null;
}
