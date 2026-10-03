import { Database, GitBranch, RotateCw, Timer } from 'lucide-react';
import type { Task } from '../shared/types';
import { statusText, useApp } from './context';
import { useNetStatusText } from './net-status';

export function Statusline({ task }: { task?: Task }) {
  const { data, t } = useApp();
  // 网络状态 (§5.5), read before the early return, as hooks must be.
  const net = useNetStatusText(task?.net);
  if (!data.ecosystem.showStatusline || !task) return null;
  const gateway = data.gateways.find(item => item.id === task.gatewayId);
  const latestUsage = [...task.messages].reverse().find(message => message.usage)?.usage;
  const rate = data.rateLimits?.[task.gatewayId];
  const netTitle = task.net?.state === 'queued' ? t('Over this gateway’s requests per minute: the request waits on this computer.', '超过了这个网关的每分钟请求上限，请求在本机排队。')
    : task.net?.state === 'cooldown' ? t('The service answered 429, so the whole gateway pauses for as long as it asked.', '服务器回了 429，整个网关按它给的时间暂停。')
      : t('The request failed and is sent again after a short wait.', '请求没成功，等一小会儿会自动再发一次。');
  return <footer className="runtime-statusline" aria-label={t('Agent status', 'Agent 状态')}>
    <span className={task.truncation ? 'statusline-truncated' : undefined}><i className={`status-diamond ${task.truncation ? 'truncated' : task.status}`} />{task.truncation ? t('Output truncated', '输出被截断') : statusText(task.status, t)}</span>
    {(gateway || task.modelId) && <span title={gateway?.name}>{task.modelId || gateway?.modelId}</span>}
    {task.worktree && <span title={task.worktree.path}><GitBranch size={11} />{task.worktree.branch}</span>}
    {latestUsage && <span title={t('Last reported response: input / output tokens', '最近回复报告的输入 / 输出 Token')}>{latestUsage.input.toLocaleString()} / {latestUsage.output.toLocaleString()} Token</span>}
    {net && <span className={task.net?.state === 'queued' ? undefined : 'statusline-truncated'} title={netTitle}>{task.net?.state === 'retrying' ? <RotateCw size={11} /> : <Timer size={11} />}{net}</span>}
    {rate && rate.cooldown > 0 && task.net?.state !== 'cooldown' && <span className="statusline-truncated" title={t('The service answered 429, so this gateway is paused.', '服务器回了 429，这个网关正在暂停。')}><Timer size={11} />{t('Gateway paused', '网关冷却')} {rate.cooldown}s</span>}
    {rate && rate.limit > 0 && rate.cooldown === 0 && <span title={t('Requests sent in the last 60 seconds, against this gateway’s limit.', '最近 60 秒内发出的请求数，与这个网关的上限相比。')}><Timer size={11} />{t('This minute', '本分钟')} {rate.used}/{rate.limit}{rate.waiting > 0 ? ` · ${rate.waiting} ${t('waiting', '排队')}` : ''}</span>}
    {!!task.compactions && <span><Database size={11} />{t('Compactions', '压缩')} {task.compactions}</span>}
    {Object.entries(task.runtimeStatus || {}).filter(([, value]) => value).map(([key, value]) => <span key={key} title={t('Runtime status', '运行状态')}>{value}</span>)}
  </footer>;
}
