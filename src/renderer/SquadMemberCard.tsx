import type { ReactNode } from 'react';
import { Check, ChevronDown, LoaderCircle, Pause } from 'lucide-react';
import type { Task } from '../shared/types';
import type { MemberTone } from '../shared/squad-view';
import { Avatar } from './Avatar';
import './squad.css';

/**
 * One squad member: who, what kind, how it is doing, and its details once opened. The workbench squad panel and the card
 * studio's squad area both draw their members with it (spec Q22).
 */
export function SquadMemberCard({ member, name, kind, state, expanded, onToggle, brief, meta, children }: {
  member: Task; name: string; kind: string; state: { label: string; tone: MemberTone };
  expanded: boolean; onToggle: () => void; brief?: ReactNode; meta?: ReactNode; children?: ReactNode;
}) {
  const closing = !!member.workerActive && ['completed', 'failed', 'cancelled'].includes(member.status);
  return <article className={`squad-member squad-member-${state.tone}`}>
    <button type="button" className="squad-member-heading" aria-expanded={expanded} aria-controls={`squad-member-${member.id}`} onClick={onToggle}>
      <span className="squad-member-mark" aria-hidden="true"><Avatar role="assistant" size={40} agentName={member.agentName || name || 'C'} /></span>
      <span className="squad-member-identity"><strong>{name}</strong><small>{kind}</small></span>
      <span className={`squad-state ${state.tone}`}>{state.tone === 'running' || closing ? <LoaderCircle size={12} className="spinning" /> : state.tone === 'completed' ? <Check size={12} /> : state.tone === 'waiting' ? <Pause size={11} /> : <span className={`status-dot ${state.tone}`} />}{state.label}</span><ChevronDown size={14} className="squad-member-chevron" />
    </button>
    {brief !== undefined && <p className="squad-member-brief">{brief}</p>}
    {meta !== undefined && <div className="squad-member-meta">{meta}</div>}
    {expanded && <div id={`squad-member-${member.id}`} className="squad-member-details">{children}</div>}
  </article>;
}
