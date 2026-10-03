import { BOARDS } from './boards.ts';
import type { RoleSummary } from '../agents.ts';
import type { Task } from '../types.ts';
import type { CardMemberRole, CardSquadAssignment, CardSquadMode, CardSquadSettings } from './types.ts';

/**
 * 工坊小队 (spec §6, ADR 0023): the 子代理 switch, who may send whom, what members may touch and the words the lead is
 * given. Pure, so the main process, the worker, the renderer and the tests read it the same way.
 */

export const CARD_SQUAD_MODES: readonly CardSquadMode[] = ['off', 'read', 'write'];
/** Spec §5.4: no setting means the switch is off and 自行组队 is on. */
export const DEFAULT_CARD_SQUAD: Readonly<CardSquadSettings> = { mode: 'off', selfDispatch: true };

/** A saved setting as the app reads it: a known 子代理 mode is kept and a missing 自行组队 takes its default; anything else is no setting. */
export function normalizeCardSquad(value: unknown): CardSquadSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { mode, selfDispatch } = value as Record<string, unknown>;
  if (!CARD_SQUAD_MODES.includes(mode as CardSquadMode)) return undefined;
  return { mode: mode as CardSquadMode, selfDispatch: typeof selfDispatch === 'boolean' ? selfDispatch : DEFAULT_CARD_SQUAD.selfDispatch };
}

/** The settings in effect. */
export function cardSquadSettings(preferences: { cardSquad?: unknown }): CardSquadSettings {
  return normalizeCardSquad(preferences.cardSquad) ?? { ...DEFAULT_CARD_SQUAD };
}

/** 自行组队 in effect: with the switch off only Ultra planning dispatches, and choosing Ultra is the consent (ADR 0023). */
export function effectiveSelfDispatch(settings: CardSquadSettings): boolean {
  return settings.mode === 'off' || settings.selfDispatch;
}

/** The two card subagents as the lead's dispatch tools list them (stage 3's `RoleSummary`); never part of the workbench's roles (spec §5.1). */
export const CARD_ROLES: Readonly<Record<CardMemberRole, RoleSummary>> = {
  researcher: { id: 'researcher', label: '查资料', description: '只读：按任务读资料和已写的组件，交回带出处的要点', readOnly: true },
  writer: { id: 'writer', label: '写组件', description: '只写分给它的组件：files 列已有的组件文件，create 列允许新建的组件名称；交回写了什么', readOnly: false },
};

/** A role as a lead names it: the id, the label, or the workbench's read-only explorer for 查资料. */
export function cardRoleId(value: string): CardMemberRole | null {
  const key = value.trim().toLowerCase();
  if (key === 'researcher' || key === '查资料' || key === 'explorer' || key === 'explore') return 'researcher';
  if (key === 'writer' || key === '写组件') return 'writer';
  return null;
}

/** The members one card conversation may start (spec §6.1): a member none; the rest by the switch, and an Ultra planning conversation 查资料 even when it is off. */
export function cardDispatchRoles(input: { settings: CardSquadSettings; sectionId: string; thinking: string; member: boolean }): CardMemberRole[] {
  if (input.member) return [];
  if (input.settings.mode === 'write') return ['researcher', 'writer'];
  if (input.settings.mode === 'read' || (input.sectionId === 'plan' && input.thinking === 'ultra')) return ['researcher'];
  return [];
}

/** The member a lead asked for (spec §5.2, §6.1): no role means 查资料; one this conversation may not send is refused with the ones it may. */
export function cardMemberKind(requested: string, allowed: readonly CardMemberRole[]): CardMemberRole {
  if (!allowed.length) throw new Error('这个对话现在不能派小队成员：工作室设置里的「子代理」是关。');
  const choices = allowed.map(role => `${CARD_ROLES[role].label}（${role}）`).join('、');
  const role = requested.trim() ? cardRoleId(requested) : 'researcher';
  if (!role) throw new Error(`「${requested}」不是工坊能派的成员。能派的：${choices}。`);
  if (!allowed.includes(role)) throw new Error(`这次不能派「${CARD_ROLES[role].label}」，能派的只有：${choices}。`);
  return role;
}

/** A member's tools, and nothing else (spec §6.2): no commands, MCP, browser, questions, dispatching or variable sync, so it never needs approval. */
export function cardMemberTools(role: CardMemberRole, web: boolean): string[] {
  return ['read', 'ls', 'card_search_sources', 'card_check', ...(role === 'writer' ? ['write', 'edit', 'card_new_component'] : []), ...(web ? ['web_search', 'fetch_content'] : [])];
}

/** A squad member of a card conversation rather than a conversation of its own. */
export function isCardMember(task: Pick<Task, 'card'>): boolean { return !!task.card?.member; }
export function cardMemberRole(task: Pick<Task, 'card'>): CardMemberRole { return task.card?.squad?.role ?? 'researcher'; }
/** 「查资料 · 名字」 / 「写组件 · 名字」 (spec Q16). */
export function cardMemberLabel(task: Pick<Task, 'card' | 'agentName' | 'title'>): string { return `${CARD_ROLES[cardMemberRole(task)].label} · ${task.agentName || task.title}`; }

/** Components only the lead writes, by the name the component file was made from (spec §6.3). */
export const SHARED_COMPONENT_NAMES: readonly string[] = ['人物总览', '地点总览', '标题剧情索引'];
const SHARED_ROOT_FILES = ['设计书.md', '变量表.yaml', '卡项目.json'];
const SHARED_LORE_FILES = ['出处索引.md', '人物模板.md', '剧情模板.md'];
/** The world book folders, as the component reader knows them (core LORE_FOLDERS; the test keeps the two equal). */
export const CARD_LORE_DIRS: readonly string[] = [...(BOARDS.find(board => board.id === 'lore')?.sections ?? []).map(section => `世界书/${section.name}`), '世界书/未分类'];

/** The name a component file was made from: 10-人物总览.md and 15-标题剧情索引~42.md give 人物总览 and 标题剧情索引. */
export function componentStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/^-?\d+(?:\.\d+)?-/, '').replace(/~\d+$/, '');
}

/** A file only the lead may write, even when a 写组件 was given it (spec §6.3). */
export function sharedCardFile(path: string): boolean {
  const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (SHARED_ROOT_FILES.includes(clean.toLowerCase())) return true;
  const parts = clean.split('/');
  if (parts[0] !== '世界书' || parts.length !== 3) return false;
  return SHARED_LORE_FILES.includes(parts[2].toLowerCase()) || SHARED_COMPONENT_NAMES.includes(componentStem(parts[2]));
}

/** A card-relative path of a component file: a world book entry's body or parameters, a regex, a script or a greeting. */
export function isComponentFile(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  if (!name || name.startsWith('.')) return false;
  if (parts[0] === '世界书') return parts.length === 3 && CARD_LORE_DIRS.includes(`${parts[0]}/${parts[1]}`) && /\.(md|json)$/.test(name);
  if (parts[0] === '正则') return parts.length === 2 && /\.(json|html|yaml)$/.test(name);
  if (parts[0] === '脚本') return parts.length === 2 && /\.(json|js)$/.test(name);
  if (parts[0] === '开场白') return (parts.length === 2 || (parts.length === 3 && parts[1] === '群聊')) && name.endsWith('.md');
  return false;
}

export const MEMBER_FILE_LIMIT = 20;
/** Spec §5.2: any role but 写组件 carrying files or create is refused, in a card conversation and in the workbench. */
export const FILES_ONLY_FOR_WRITERS = 'files 和 create 只给「写组件」用。';

/** What a member may write (spec §5.2, §6.3). `files` still have to be checked against the card folder. */
export function checkAssignment(role: CardMemberRole, input: { files?: readonly string[]; create?: readonly string[] }): CardSquadAssignment {
  const files = [...new Set((input.files ?? []).map(item => item.trim()).filter(Boolean))];
  const create = [...new Set((input.create ?? []).map(item => item.trim()).filter(Boolean))];
  if (role !== 'writer') {
    if (files.length || create.length) throw new Error(FILES_ONLY_FOR_WRITERS);
    return { role, files: [], create: [] };
  }
  if (!files.length && !create.length) throw new Error('派「写组件」要写明它写哪些组件：files 列已有组件文件，create 列允许新建的组件名称。');
  if (files.length > MEMBER_FILE_LIMIT || create.length > MEMBER_FILE_LIMIT) throw new Error(`一个「写组件」最多分 ${MEMBER_FILE_LIMIT} 个文件、新建 ${MEMBER_FILE_LIMIT} 个组件。`);
  for (const name of create) {
    if ([...name].length > 60 || /[\\/:*?"<>|]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32)) throw new Error(`「${name}」不能当组件名称：最多 60 个字，不含 \\ / : * ? " < > | 这些字符。`);
    if (SHARED_COMPONENT_NAMES.includes(name)) throw new Error(`「${name}」是主 AI 的共享组件，留给主 AI 最后统一写。`);
  }
  return { role, files, create };
}

/** The files a 写组件 holds (spec §6.3): the ones it was given, then those of the components it created. */
export function heldFiles(assignment: Pick<CardSquadAssignment, 'files' | 'created'>): string[] {
  return [...assignment.files, ...(assignment.created ?? []).flatMap(component => component.paths)];
}

/** The files and new components the working writers of one lead hold. */
export interface SquadClaims { files: Set<string>; create: Set<string> }
/** What these assignments hold, to claim a new member or a returning one against. */
export function squadClaims(held: readonly CardSquadAssignment[]): SquadClaims {
  return { files: new Set(held.flatMap(squad => heldFiles(squad).map(path => path.toLowerCase()))), create: new Set(held.flatMap(squad => squad.create)) };
}
/** Two working writers never get the same file or the same new component. */
export function claimAssignment(claims: SquadClaims, assignment: CardSquadAssignment): void {
  const files = heldFiles(assignment);
  for (const path of files) if (claims.files.has(path.toLowerCase())) throw new Error(`「${path}」已经分给了别的成员。`);
  for (const name of assignment.create) if (claims.create.has(name)) throw new Error(`「${name}」已经分给了别的成员。`);
  for (const path of files) claims.files.add(path.toLowerCase());
  for (const name of assignment.create) claims.create.add(name);
}

/** The lines around the 自行组队 variants in 小队-派发.md (spec §6.5); the app keeps one variant and drops the markers. */
export const SELF_DISPATCH_ON = '<!-- 自行组队：开 -->';
export const SELF_DISPATCH_OFF = '<!-- 自行组队：关 -->';
export const SELF_DISPATCH_END = '<!-- 自行组队：完 -->';

/** Whether every 自行组队 block is closed by its end marker, and every end marker closes one. */
function markersPair(lines: readonly string[]): boolean {
  let open = false;
  for (const line of lines) {
    const marker = line.trim();
    if (marker === SELF_DISPATCH_ON || marker === SELF_DISPATCH_OFF) open = true;
    else if (marker === SELF_DISPATCH_END) { if (!open) return false; open = false; }
  }
  return !open;
}

/**
 * The 派发 rules a lead gets: the variant for 自行组队 in effect. An override without the markers is used as written, and so is
 * one whose markers do not pair up (an edit that lost one), so the rules after them are never dropped.
 */
export function squadDispatchPrompt(text: string, options: { selfDispatch: boolean }): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!markersPair(lines)) return lines.join('\n').trim();
  const kept: string[] = [];
  let block: 'on' | 'off' | null = null;
  for (const line of lines) {
    const marker = line.trim();
    if (marker === SELF_DISPATCH_ON) { block = 'on'; continue; }
    if (marker === SELF_DISPATCH_OFF) { block = 'off'; continue; }
    if (marker === SELF_DISPATCH_END) { block = null; continue; }
    if (block === null || (block === 'on') === options.selfDispatch) kept.push(line);
  }
  return kept.join('\n').trim();
}
