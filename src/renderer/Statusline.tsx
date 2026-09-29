import { Database, GitBranch, Timer } from 'lucide-react';
import type { Task } from '../shared/types';
import { statusText, useApp } from './context';

export function Statusline({ task }: { task?: Task }) {
  const { data, t } = useApp();
  if (!data.ecosystem.showStatusline || !task) return null;
  const gateway = data.gateways.find(item => item.id === task.gatewayId);
  const latestUsage = [...task.messages].reverse().find(message => message.usage)?.usage;
  const rate = data.rateLimits?.[task.gatewayId];
  return <footer className="runtime-statusline" aria-label={t('Agent status', 'Agent 状态')}>
    <span className={task.truncation ? 'statusline-truncated' : undefined}><i className={`status-diamond ${task.truncation ? 'truncated' : task.status}`} />{task.truncation ? t('Output truncated', '输出被截断') : statusText(task.status, t)}</span>
    {(gateway || task.modelId) && <span title={gateway?.name}>{task.modelId || gateway?.modelId}</span>}
    {task.worktree && <span title={task.worktree.path}><GitBranch size={11} />{task.worktree.branch}</span>}
    {latestUsage && <span title={t('Last reported response: input / output tokens', '最近回复报告的输入 / 输出 Token')}>{latestUsage.input.toLocaleString()} / {latestUsage.output.toLocaleString()} Token</span>}
    {rate && rate.cooldown > 0 && <span className="statusline-truncated" title={t('The service answered 429, so this gateway is paused.', '服务器回了 429，这个网关正在暂停。')}><Timer size={11} />{t('Gateway paused', '网关冷却')} {rate.cooldown}s</span>}
    {rate && rate.limit > 0 && rate.cooldown === 0 && <span title={t('Requests sent in the last 60 seconds, against this gateway’s limit.', '最近 60 秒内发出的请求数，与这个网关的上限相比。')}><Timer size={11} />{t('This minute', '本分钟')} {rate.used}/{rate.limit}{rate.waiting > 0 ? ` · ${rate.waiting} ${t('waiting', '排队')}` : ''}</span>}
    {!!task.compactions && <span><Database size={11} />{t('Compactions', '压缩')} {task.compactions}</span>}
    {Object.entries(task.runtimeStatus || {}).filter(([, value]) => value).map(([key, value]) => <span key={key} title={t('Runtime status', '运行状态')}>{value}</span>)}
  </footer>;
}
