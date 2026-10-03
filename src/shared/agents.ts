import type { AgentRole } from './types.ts';
import { BUILTIN_ROLES } from '../core/ecosystem.ts';

/** Subagents found as Markdown files under `.claude/agents` (§6.2), in Claude Code's own format. */
export interface DiscoveredAgent {
  id: string; name: string; description: string; prompt: string; readOnly: boolean;
  tools?: string[]; model?: string; source: 'project' | 'user'; path: string; projectId?: string;
}
/** Claude Code knows a subagent by its name; Cardwright knows its own roles by their id. Two subagents with one key are one subagent. */
export function roleKey(role: Pick<AgentRole, 'id' | 'name' | 'source'>): string {
  return (role.source === 'project' || role.source === 'user' ? role.name : role.id).toLowerCase();
}

/** 1.3.0 §5.1: the ids the built-in roles had before 1.3, and their new ids. A Map, so no inherited key ever matches. Declared before READ_ONLY_BUILT_INS, which reads it when the module loads. */
const LEGACY_ROLE_IDS = new Map<string, string>([['general-purpose', 'executor'], ['explore', 'explorer'], ['plan', 'planner']]);

/**
 * The names the read-only built-ins answer to, lower case: explorer and planner, and their 1.2 ids `Explore` and `Plan`.
 * A file named Explore captures that 1.2 id (a lead's `Explore` reaches the file by its name), so it must read as read-only as well.
 */
const READ_ONLY_BUILT_INS: ReadonlySet<string> = new Set(BUILTIN_ROLES.filter(role => role.readOnly).flatMap(role => {
  const key = roleKey(role);
  return [key, ...[...LEGACY_ROLE_IDS].filter(([, id]) => id === key).map(([legacy]) => legacy)];
}));
/**
 * Whether a task running as this subagent only reads: the subagent says so, or it answers to the name of a read-only built-in.
 * A file that takes explorer's or planner's place brings its own description and instructions, never write access (1.3.0: 只读不会被同名角色顶替).
 * The app enforces this when it makes a task; the settings and the lead's role list say the same.
 */
export function readsOnly(role: Pick<AgentRole, 'id' | 'name' | 'source' | 'readOnly'>): boolean {
  return role.readOnly || READ_ONLY_BUILT_INS.has(roleKey(role));
}
/**
 * Whether a subagent is the planner or stands in for it: the built-in, or a file named planner or Plan (its 1.2 id). Tasks made
 * as one start in plan mode. The name decides, not the id: a file's id is `agent:…`, never `planner`.
 */
export function answersAsPlanner(role: Pick<AgentRole, 'id' | 'name' | 'source'>): boolean {
  return canonicalRoleId(roleKey(role)) === 'planner';
}
/** A subagent file that is on and answers to the name of a read-only built-in: it takes that role's place for its description and instructions, and the task still only reads. */
export function replacesReadOnlyBuiltIn(role: AgentRole): boolean {
  return (role.source === 'project' || role.source === 'user') && role.enabled !== false && !role.shadowedBy && READ_ONLY_BUILT_INS.has(roleKey(role));
}

const ORDER: Record<NonNullable<AgentRole['source']>, number> = { project: 0, user: 1, custom: 2, builtin: 3 };
const rank = (role: AgentRole) => ORDER[role.source ?? (role.builtIn ? 'builtin' : 'custom')];

/** The subagent that answers to a key: project over user over custom over built-in; the first of equals. */
function winner(candidates: readonly AgentRole[], key: string): AgentRole | undefined {
  let best: AgentRole | undefined;
  for (const role of candidates) if (roleKey(role) === key && (!best || rank(role) < rank(best))) best = role;
  return best;
}

/**
 * The one list the settings page and the composer read: built-in roles, the user's own, then what was discovered.
 * A project folder's subagents are off until the user turns them on (`enabled`, Q25); every other one is on until the
 * user turns it off (`disabled`). Same name: project beats user beats custom beats built-in — but only a subagent that is
 * on takes another's place, and the list for no particular project marks nothing on account of one project's files.
 */
export function mergeAgents(input: { saved: AgentRole[]; discovered: DiscoveredAgent[]; disabled: string[]; enabled?: string[]; projectId?: string }): AgentRole[] {
  const disabled = new Set(input.disabled.map(id => canonicalRoleId(id)));
  const switchedOn = new Set(input.enabled ?? []);
  const discovered = input.discovered.filter(agent => !agent.projectId || !input.projectId || agent.projectId === input.projectId);
  const saved = input.saved.map((role): AgentRole => {
    // A profile saved by 1.2 may still hold the built-ins under their old ids (§5.1).
    const id = role.builtIn ? canonicalRoleId(role.id) : role.id;
    return { ...role, id, source: role.builtIn ? 'builtin' : 'custom', enabled: !disabled.has(id) };
  });
  const found = discovered.map((agent): AgentRole => ({
    id: agent.id, name: agent.name, prompt: agent.prompt, readOnly: agent.readOnly, description: agent.description,
    source: agent.source, path: agent.path,
    enabled: agent.source === 'project' ? switchedOn.has(agent.id) && !disabled.has(agent.id) : !disabled.has(agent.id),
    ...(agent.tools ? { tools: agent.tools } : {}), ...(agent.model ? { model: agent.model } : {}), ...(agent.projectId ? { projectId: agent.projectId } : {}),
  }));
  const all = [...saved, ...found];
  const inScope = (role: AgentRole) => input.projectId !== undefined || !role.projectId;
  const live = all.filter(role => role.enabled !== false && inScope(role));
  for (const role of all) {
    if (!inScope(role)) continue;
    const best = winner(live, roleKey(role));
    if (best && best.id !== role.id) role.shadowedBy = best.id;
  }
  return all;
}

/** What a task may use in this project: on, this project's or everyone's, and the one that answers to its name here. */
export function usableAgents(roles: AgentRole[], projectId?: string): AgentRole[] {
  const candidates = roles.filter(role => role.enabled !== false && (!role.projectId || role.projectId === projectId));
  return candidates.filter(role => winner(candidates, roleKey(role)) === role);
}

/** The ids a subagent made in settings may have. `saveAgentRole` enforces it; the Role ID field's `pattern` says the same, written the way a browser accepts. */
export const CUSTOM_ROLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/** The role ids Cardwright owns (§5.1): the workbench's three built-ins and the card studio's 查资料 / 写组件. */
export const RESERVED_ROLE_IDS = ['executor', 'explorer', 'planner', 'researcher', 'writer'] as const;

/**
 * An old built-in id (`general-purpose`, `Explore`, `Plan`, in any case) becomes its new id; every other id — a custom or
 * a discovered one included — comes back as it is. Persisted data and every input go through this (§5.1).
 */
export function canonicalRoleId(id: string): string {
  return LEGACY_ROLE_IDS.get(id.toLowerCase()) ?? id;
}

/** True for an id a custom role may not take, however it is spelled: the reserved ids and the old built-in ones. */
export function isReservedRoleId(id: string): boolean {
  return (RESERVED_ROLE_IDS as readonly string[]).includes(canonicalRoleId(id).toLowerCase());
}

/** A record keyed by role id, with the old built-in ids moved to the new ones; an entry already under a new id wins. */
export function canonicalRoleKeys<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const entries = Object.entries(record);
  const kept = new Map(entries.filter(([key]) => canonicalRoleId(key) === key));
  for (const [key, value] of entries) if (!kept.has(canonicalRoleId(key))) kept.set(canonicalRoleId(key), value);
  return Object.fromEntries(kept);
}

/**
 * The custom roles of a role list saved before 1.3.0 (state.json, a backup). Copies of built-in roles are dropped — the
 * app always supplies its own — and a custom role that used an id Cardwright now reserves keeps everything under
 * `<id>-custom`; `renamed` maps its old id to the new one so tasks and switches can follow.
 */
export function savedCustomRoles(saved: readonly AgentRole[]): { roles: AgentRole[]; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  const custom = saved.filter(role => !role.builtIn && !LEGACY_ROLE_IDS.has(role.id.toLowerCase()));
  const taken = new Set<string>([...RESERVED_ROLE_IDS, ...custom.map(role => role.id.toLowerCase())]);
  const roles = custom.map(role => {
    if (!isReservedRoleId(role.id)) return role;
    let id = `${role.id}-custom`;
    for (let index = 2; taken.has(id.toLowerCase()); index++) id = `${role.id}-custom-${index}`;
    taken.add(id.toLowerCase());
    renamed.set(role.id, id);
    return { ...role, id };
  });
  return { roles, renamed };
}

/** The name a lead dispatches a subagent by: a discovered one by its file's name, as in Claude Code; Cardwright's own by id. */
export function dispatchName(role: Pick<AgentRole, 'id' | 'name' | 'source'>): string {
  return role.source === 'project' || role.source === 'user' ? role.name : role.id;
}

/**
 * The usable subagent a request names: its id, its name in any case, or a 1.2 id such as `general-purpose` (§5.1).
 * `roles` is a usable list, so no name ever reaches a subagent that is off or replaced.
 */
export function findRole(roles: AgentRole[], requested: string): AgentRole | undefined {
  const value = requested.trim();
  if (!value) return undefined;
  const canonical = canonicalRoleId(value);
  return roles.find(role => role.id === value)
    ?? roles.find(role => roleKey(role) === value.toLowerCase())
    ?? roles.find(role => role.id === canonical || roleKey(role) === canonical.toLowerCase());
}

/** The one line a lead reads about a subagent: its 说明, else the first line of its instructions; at most 300 characters. */
export function roleDescription(role: Pick<AgentRole, 'description' | 'prompt'>): string {
  const line = (role.description?.trim() || role.prompt.split(/\r?\n/).map(item => item.trim()).find(Boolean) || '').replace(/\s+/g, ' ');
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

/** One line of the role list in the dispatch tools' description (stage 2's `describeRoles`). */
export interface RoleSummary { id: string; label: string; description: string; readOnly: boolean }
export function roleSummaries(roles: AgentRole[]): RoleSummary[] {
  // readsOnly, not role.readOnly: a file standing in for explorer or planner only reads, so the lead is not told it is writable.
  return roles.map(role => ({ id: dispatchName(role), label: role.name, description: roleDescription(role), readOnly: readsOnly(role) }));
}

/** The name to show for a subagent id: a file's subagent by its file's name (`agent:user:x` is x), every other id as it is. */
export function roleLabel(id: string): string {
  return id.startsWith('agent:') ? id.slice(id.lastIndexOf(':') + 1) : id;
}

/**
 * Why a task cannot run as this subagent here, in words for the user and the lead; undefined when it can.
 * A lead or the user may name a subagent by its file's name, and a name finds the one that is off too. A task keeps the exact
 * id it was made with: with `exact` only that id counts, never another subagent that merely answers to the same name, so a
 * refusal for a task always has a reason.
 */
export function roleUnavailable(roles: AgentRole[], id: string, projectId?: string, options: { exact?: boolean } = {}): string | undefined {
  const usable = usableAgents(roles, projectId);
  if (usable.some(role => role.id === id)) return undefined;
  const scoped = roles.filter(item => !item.projectId || item.projectId === projectId);
  const role = scoped.find(item => item.id === id) ?? (options.exact ? undefined : findRole(scoped, id));
  if (!role) return `找不到子代理「${roleLabel(id)}」，它可能已被删除。`;
  if (usable.includes(role)) return undefined;
  if (role.enabled === false) return `子代理「${role.name}」已关闭。`;
  const replacement = usable.find(item => roleKey(item) === roleKey(role));
  return `子代理「${role.name}」被同名的「${replacement?.name ?? roleLabel(role.shadowedBy ?? role.id)}」顶替了。`;
}
