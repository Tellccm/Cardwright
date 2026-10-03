import type { Task } from './types.ts';

/** How one squad member is doing, as its card shows it; the workbench panel and the card studio read it the same way. */
export type MemberTone = 'waiting' | 'completed' | 'failed' | 'cancelled' | 'queued' | 'running' | 'idle';

export function memberInProgress(task: Pick<Task, 'status' | 'workerActive'>): boolean {
  return ['queued', 'running', 'waiting'].includes(task.status) || !!task.workerActive;
}

/** `pending` says whether the member waits on an approval or on an answer from the user. */
export function memberState(member: Pick<Task, 'status' | 'workerActive'>, pending: { approval: boolean; question: boolean }, t: (english: string, chinese: string) => string): { label: string; tone: MemberTone } {
  if (pending.approval) return { label: t('Needs approval', '等待审批'), tone: 'waiting' };
  if (pending.question) return { label: t('Needs your input', '等待回应'), tone: 'waiting' };
  if (member.status === 'completed') return { label: member.workerActive ? t('Returning result', '正在返回结果') : t('Returned · closed', '已返回 · 已关闭'), tone: 'completed' };
  if (member.status === 'failed') return { label: member.workerActive ? t('Failed · closing', '失败 · 正在关闭') : t('Failed · closed', '失败 · 已关闭'), tone: 'failed' };
  if (member.status === 'cancelled') return { label: member.workerActive ? t('Stopping', '正在停止') : t('Stopped · closed', '已停止 · 已关闭'), tone: 'cancelled' };
  if (member.status === 'queued') return { label: t('Queued', '等待执行'), tone: 'queued' };
  if (member.status === 'waiting') return { label: t('Waiting', '等待中'), tone: 'waiting' };
  if (member.status === 'running') return { label: t('Working', '执行中'), tone: 'running' };
  return { label: t('Ready', '待开始'), tone: 'idle' };
}
