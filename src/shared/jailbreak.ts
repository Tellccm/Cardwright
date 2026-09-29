/**
 * 破限 — a set of creative-framing prompts sent ahead of a request.
 *
 * A pack is the author's own text, or entries the user picked out of a
 * SillyTavern preset. Cardwright only places and forwards them: nothing here
 * rewrites the text, and the request diagnostic shows exactly what went out.
 *
 * Placement follows the preset convention the text was written for:
 * - `system`  goes in front of Cardwright's own system prompt;
 * - `opening` becomes an opening exchange at the head of the conversation;
 * - `tail`    is appended after the newest user message.
 */

export type JailbreakPlacement = 'system' | 'opening' | 'tail';
export type JailbreakRole = 'system' | 'user' | 'assistant';

export interface JailbreakEntry {
  id: string;
  name: string;
  role: JailbreakRole;
  placement: JailbreakPlacement;
  content: string;
}

export interface JailbreakPack {
  id: string;
  name: string;
  /** Ships with the application; a user pack is stored in the data folder. */
  builtIn?: boolean;
  entries: JailbreakEntry[];
}

/** What a task or a card remembers. Absent means the toggle is off. */
export interface JailbreakChoice { pack: string }

/** What the picker shows; the text itself never travels to the view. */
export interface JailbreakPackSummary { id: string; name: string; builtIn: boolean; entries: number }

export interface JailbreakVariables {
  /** {{user}} — the reader's name; the preference, or a neutral fallback. */
  user: string;
  /** {{char}} — the card being written; empty in the workbench. */
  char: string;
}

const COMMENT_MACRO = /\{\{\/\/[\s\S]*?\}\}/g;
const SETVAR_MACRO = /\{\{(?:set|add|incr|decr)var::[\s\S]*?\}\}/gi;
const ANY_MACRO = /\{\{[^{}]*\}\}/g;

/**
 * Applies the macros Cardwright can resolve and drops the two that only mean
 * something inside SillyTavern. Every other macro is left exactly as written,
 * because silently deleting an author's text would be worse than passing it on.
 */
export function expandMacros(text: string, variables: JailbreakVariables): string {
  return text
    .replace(COMMENT_MACRO, '')
    .replace(SETVAR_MACRO, '')
    .replace(/\{\{user\}\}/gi, variables.user)
    .replace(/\{\{char\}\}/gi, variables.char)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Macros left unresolved, so an import can say what will be sent verbatim. */
export function unresolvedMacros(text: string): string[] {
  const stripped = text.replace(COMMENT_MACRO, '').replace(SETVAR_MACRO, '');
  const found = new Set<string>();
  for (const match of stripped.matchAll(ANY_MACRO)) {
    const macro = match[0];
    if (/^\{\{(user|char)\}\}$/i.test(macro)) continue;
    found.add(macro);
  }
  return [...found];
}

export interface AssembledJailbreak {
  /** Placed ahead of Cardwright's own system prompt. */
  system: string;
  /** An opening exchange inserted at the head of the conversation. */
  opening: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Appended after the newest user message. */
  tail: string;
}

export function assembleJailbreak(pack: JailbreakPack | undefined, variables: JailbreakVariables): AssembledJailbreak | undefined {
  if (!pack?.entries.length) return undefined;
  const system: string[] = [];
  const opening: AssembledJailbreak['opening'] = [];
  const tail: string[] = [];
  for (const entry of pack.entries) {
    const content = expandMacros(entry.content, variables);
    if (!content) continue;
    if (entry.placement === 'system') system.push(content);
    else if (entry.placement === 'tail') tail.push(content);
    else if (entry.role === 'user' || entry.role === 'assistant') opening.push({ role: entry.role, content });
    // An opening entry with the system role has no seat in a chat exchange; it joins the system text.
    else system.push(content);
  }
  if (!system.length && !opening.length && !tail.length) return undefined;
  return { system: system.join('\n\n'), opening, tail: tail.join('\n\n') };
}

/** The shape a SillyTavern chat-completion preset stores its prompts in. */
interface PresetPrompt {
  identifier?: unknown; name?: unknown; role?: unknown; content?: unknown;
  marker?: unknown; injection_position?: unknown;
}
interface PresetFile {
  name?: unknown;
  prompts?: unknown;
  prompt_order?: unknown;
}

function readRole(value: unknown): JailbreakRole {
  return value === 'user' || value === 'assistant' ? value : 'system';
}

export interface PresetImportEntry extends JailbreakEntry {
  /** The preset had this entry switched on, which is a useful default to offer. */
  enabled: boolean;
  /** Macros Cardwright will pass through untouched. */
  unresolved: string[];
}

/**
 * Reads a preset into entries the user can pick from. Ordering and placement
 * come from the preset's own order relative to its chat-history marker, so an
 * imported set keeps the arrangement its author designed.
 */
export function readPreset(file: unknown): { name: string; entries: PresetImportEntry[] } {
  const preset = (file ?? {}) as PresetFile;
  const prompts = Array.isArray(preset.prompts) ? preset.prompts as PresetPrompt[] : [];
  const byId = new Map<string, PresetPrompt>();
  for (const prompt of prompts) if (typeof prompt?.identifier === 'string') byId.set(prompt.identifier, prompt);

  const orders = Array.isArray(preset.prompt_order) ? preset.prompt_order as Array<{ order?: unknown }> : [];
  const order = orders.map(entry => Array.isArray(entry?.order) ? entry.order as Array<{ identifier?: unknown; enabled?: unknown }> : [])
    .reduce((longest, current) => current.length > longest.length ? current : longest, [] as Array<{ identifier?: unknown; enabled?: unknown }>);

  const sequence = order.length
    ? order.map(item => ({ id: String(item?.identifier ?? ''), enabled: item?.enabled !== false }))
    : prompts.map(prompt => ({ id: String(prompt?.identifier ?? ''), enabled: true }));

  const historyIndex = sequence.findIndex(item => item.id === 'chatHistory');
  const entries: PresetImportEntry[] = [];
  sequence.forEach((item, index) => {
    const prompt = byId.get(item.id);
    if (!prompt) return;
    // Markers are SillyTavern's own slots (character definition, chat history); they carry no text of their own.
    if (prompt.marker === true) return;
    const content = typeof prompt.content === 'string' ? prompt.content : '';
    if (!content.trim()) return;
    const role = readRole(prompt.role);
    const afterHistory = historyIndex >= 0 && index > historyIndex;
    // injection_position 1 is SillyTavern's in-chat injection; the closest honest placement here is the tail.
    const inChat = Number(prompt.injection_position) === 1;
    const placement: JailbreakPlacement = afterHistory || inChat ? 'tail' : role === 'system' ? 'system' : 'opening';
    entries.push({
      id: item.id, name: typeof prompt.name === 'string' && prompt.name.trim() ? prompt.name.trim() : item.id,
      role, placement, content, enabled: item.enabled, unresolved: unresolvedMacros(content),
    });
  });
  return { name: typeof preset.name === 'string' && preset.name.trim() ? preset.name.trim() : '导入的预设', entries };
}

/** Validate a pack read back from disk before it is used or shown. */
export function normalizeJailbreakPack(value: unknown): JailbreakPack {
  const pack = (value ?? {}) as Partial<JailbreakPack>;
  if (typeof pack.id !== 'string' || !pack.id.trim() || !/^[a-zA-Z0-9_-]{1,100}$/.test(pack.id)) throw new Error('破限套的标识不合法。');
  if (typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 120) throw new Error('破限套需要一个不超过 120 字的名称。');
  if (!Array.isArray(pack.entries) || !pack.entries.length) throw new Error('破限套里至少要有一条内容。');
  if (pack.entries.length > 500) throw new Error('破限套最多 500 条。');
  const entries = pack.entries.map((entry, index) => {
    const item = (entry ?? {}) as Partial<JailbreakEntry>;
    if (typeof item.content !== 'string' || !item.content.trim()) throw new Error(`第 ${index + 1} 条没有内容。`);
    if (item.content.length > 200_000) throw new Error(`第 ${index + 1} 条太长了。`);
    if (item.placement !== 'system' && item.placement !== 'opening' && item.placement !== 'tail') throw new Error(`第 ${index + 1} 条的位置不合法。`);
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.slice(0, 200) : `entry-${index + 1}`,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 200) : `第 ${index + 1} 条`,
      role: readRole(item.role), placement: item.placement, content: item.content,
    };
  });
  return { id: pack.id, name: pack.name.trim(), ...(pack.builtIn ? { builtIn: true } : {}), entries };
}
