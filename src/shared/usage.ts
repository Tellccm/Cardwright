import type { Task, Usage } from './types.ts';

export interface TokenTotals { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
export interface TaskUsage { id: string; title: string; projectId: string; messages: number; tokens: TokenTotals; lastMessageAt: string }
export interface DayUsage { date: string; tokens: TokenTotals; messages: number; unreported: number; tasks: TaskUsage[]; future: boolean; /** Tokens of tasks that were deleted; they have no entry in `tasks`. */ deleted: TokenTotals }
export interface ModelUsage { model: string | null; tokens: TokenTotals; responses: number; unreported: number }
export interface UsageReport { tokens: TokenTotals; messages: number; responses: number; unreported: number; sessions: number; activeDays: number; tasks: TaskUsage[]; models: ModelUsage[]; days: DayUsage[]; deleted: TokenTotals }

/**
 * What a deleted task contributed, kept so that removing a conversation never
 * rewrites what a past day cost. It holds counts only: no titles, no text.
 */
export interface UsageLedgerDay {
  date: string; tokens: TokenTotals; messages: number; responses: number; unreported: number;
  models: Array<{ model: string | null; tokens: TokenTotals; responses: number; unreported: number }>;
}

export function emptyTokens(): TokenTotals { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }; }

/** Local calendar dates match the desktop calendar, including near UTC midnight. */
export function localDayKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function tokenTotals(usage?: Usage): TokenTotals {
  const totals = emptyTokens();
  if (!usage) return totals;
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    const value = usage[key];
    totals[key] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    totals.total += totals[key];
  }
  return totals;
}
function addTokens(target: TokenTotals, value: TokenTotals): void {
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) target[key] += value[key];
}

/**
 * Reduce tasks to ledger days before they are deleted, so their tokens survive.
 * Called with the tasks about to go; the result is merged into the saved ledger.
 */
export function summarizeTaskUsage(tasks: readonly Task[]): UsageLedgerDay[] {
  const days = new Map<string, UsageLedgerDay>();
  for (const task of tasks) for (const message of new Map([...task.messages, ...(task.revisions || []).flatMap(revision => revision.messages)].map(message => [message.id, message])).values()) {
    const at = Date.parse(message.at);
    if (!Number.isFinite(at)) continue;
    const date = localDayKey(at);
    let day = days.get(date);
    if (!day) { day = { date, tokens: emptyTokens(), messages: 0, responses: 0, unreported: 0, models: [] }; days.set(date, day); }
    const tokens = tokenTotals(message.usage);
    day.messages++; addTokens(day.tokens, tokens);
    if (message.role !== 'assistant' && message.usage === undefined) continue;
    day.responses++;
    const missing = message.usage === undefined;
    if (missing) day.unreported++;
    const name = message.model?.trim() || null;
    let model = day.models.find(item => item.model === name);
    if (!model) { model = { model: name, tokens: emptyTokens(), responses: 0, unreported: 0 }; day.models.push(model); }
    model.responses++; if (missing) model.unreported++;
    addTokens(model.tokens, tokens);
  }
  return [...days.values()];
}

/** Fold new ledger days into the saved ones, keeping one entry per date. */
export function mergeUsageLedger(saved: readonly UsageLedgerDay[], added: readonly UsageLedgerDay[]): UsageLedgerDay[] {
  const days = new Map<string, UsageLedgerDay>();
  for (const entry of [...saved, ...added]) {
    const existing = days.get(entry.date);
    if (!existing) { days.set(entry.date, { ...entry, tokens: { ...entry.tokens }, models: entry.models.map(model => ({ ...model, tokens: { ...model.tokens } })) }); continue; }
    existing.messages += entry.messages; existing.responses += entry.responses; existing.unreported += entry.unreported;
    addTokens(existing.tokens, entry.tokens);
    for (const model of entry.models) {
      const target = existing.models.find(item => item.model === model.model);
      if (!target) { existing.models.push({ ...model, tokens: { ...model.tokens } }); continue; }
      target.responses += model.responses; target.unreported += model.unreported; addTokens(target.tokens, model.tokens);
    }
  }
  return [...days.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/** Aggregate actual message dates; renaming a task never creates new usage. */
export function buildUsageReport(tasks: readonly Task[], options: { now?: number; days?: number; weeks?: number; ledger?: readonly UsageLedgerDay[] } = {}): UsageReport {
  const now = options.now ?? Date.now();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const period = options.days ?? 0;
  const start = new Date(today);
  if (period > 0) start.setDate(start.getDate() - period + 1);
  const startTime = period > 0 ? start.getTime() : -Infinity;
  const totals = emptyTokens();
  const days = new Map<string, DayUsage>();
  const taskMap = new Map<string, TaskUsage>();
  const models = new Map<string, ModelUsage>();
  let messages = 0; let responses = 0; let unreported = 0;
  function recordTask(list: TaskUsage[] | Map<string, TaskUsage>, task: Task, at: string, tokens: TokenTotals) {
    let entry = list instanceof Map ? list.get(task.id) : list.find(item => item.id === task.id);
    if (!entry) {
      entry = { id: task.id, title: task.title, projectId: task.projectId, messages: 0, tokens: emptyTokens(), lastMessageAt: at };
      if (list instanceof Map) list.set(task.id, entry); else list.push(entry);
    }
    entry.messages++; addTokens(entry.tokens, tokens);
    if (Date.parse(at) > Date.parse(entry.lastMessageAt)) entry.lastMessageAt = at;
  }
  for (const task of tasks) for (const message of new Map([...task.messages, ...(task.revisions || []).flatMap(revision => revision.messages)].map(message => [message.id, message])).values()) {
    const at = Date.parse(message.at);
    if (!Number.isFinite(at) || at < startTime || at > now) continue;
    const date = localDayKey(at);
    let day = days.get(date);
    if (!day) { day = { date, tokens: emptyTokens(), messages: 0, unreported: 0, tasks: [], future: false, deleted: emptyTokens() }; days.set(date, day); }
    const tokens = tokenTotals(message.usage);
    messages++; day.messages++; addTokens(totals, tokens); addTokens(day.tokens, tokens);
    recordTask(taskMap, task, message.at, tokens); recordTask(day.tasks, task, message.at, tokens);
    if (message.role !== 'assistant' && message.usage === undefined) continue;
    responses++;
    const missing = message.usage === undefined;
    if (missing) { unreported++; day.unreported++; }
    // Never infer an old response's model from a gateway that can change later.
    const name = message.model?.trim() || null;
    let model = models.get(name || '');
    if (!model) { model = { model: name, tokens: emptyTokens(), responses: 0, unreported: 0 }; models.set(name || '', model); }
    model.responses++; if (missing) model.unreported++;
    addTokens(model.tokens, tokens);
  }
  // Deleted tasks are gone, but the days they cost are not rewritten.
  const deleted = emptyTokens();
  for (const entry of options.ledger ?? []) {
    const at = Date.parse(`${entry.date}T12:00:00`);
    if (!Number.isFinite(at) || at < startTime || at > now) continue;
    let day = days.get(entry.date);
    if (!day) { day = { date: entry.date, tokens: emptyTokens(), messages: 0, unreported: 0, tasks: [], future: false, deleted: emptyTokens() }; days.set(entry.date, day); }
    messages += entry.messages; responses += entry.responses; unreported += entry.unreported;
    day.messages += entry.messages; day.unreported += entry.unreported;
    addTokens(totals, entry.tokens); addTokens(day.tokens, entry.tokens);
    addTokens(day.deleted, entry.tokens); addTokens(deleted, entry.tokens);
    for (const item of entry.models) {
      let model = models.get(item.model || '');
      if (!model) { model = { model: item.model, tokens: emptyTokens(), responses: 0, unreported: 0 }; models.set(item.model || '', model); }
      model.responses += item.responses; model.unreported += item.unreported; addTokens(model.tokens, item.tokens);
    }
  }
  const calendarStart = new Date(start);
  const weeks = Math.min(53, Math.max(1, options.weeks ?? 20));
  if (period === 0) calendarStart.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7);
  const cells = period > 0 ? period : weeks * 7;
  const calendar: DayUsage[] = [];
  for (let index = 0; index < cells; index++) {
    const date = new Date(calendarStart); date.setDate(calendarStart.getDate() + index);
    const key = localDayKey(date);
    const day = days.get(key) || { date: key, tokens: emptyTokens(), messages: 0, unreported: 0, tasks: [], future: date.getTime() > today.getTime(), deleted: emptyTokens() };
    day.tasks.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)); calendar.push(day);
  }
  return { tokens: totals, messages, responses, unreported, sessions: taskMap.size, activeDays: days.size,
    tasks: [...taskMap.values()].sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)),
    models: [...models.values()].sort((a, b) => b.tokens.total - a.tokens.total || b.responses - a.responses), days: calendar, deleted };
}
