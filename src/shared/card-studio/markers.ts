import { DISPATCH_FENCE, parseDispatchContent, type DispatchParse } from './dispatch.ts';
import { fenceKind, findFences, normalizeNewlines } from './fences.ts';
import { HANDOFF_FENCE, parseHandoffContent, type Handoff } from './handoff.ts';

/** A section AI ends a question round with this line; the interface then offers 【全部按推荐】. */
export const ACCEPT_ALL_MARKER = '<!-- cardwright:accept-all -->';
export const ACCEPT_ALL_TEXT = '全部按推荐';
/** A section AI that will not start (no design book, a conflict, a missing prerequisite) ends its reply with this line. */
export const REFUSE_MARKER = '<!-- cardwright:refuse -->';
/** A lead whose squad left gaps it could not close ends its reply with this line; one-click making pauses (spec §5.3). */
export const INCOMPLETE_MARKER = '<!-- cardwright:incomplete -->';
/** A section AI that did only part of its dispatch this round ends the reply with this line; one-click making then sends 继续 instead of marking the dispatch done (分批写, ADR 0024). */
export const CONTINUE_MARKER = '<!-- cardwright:continue -->';
/** Every line a reply may end with for the app to read; the interface hides them all. */
export const REPLY_MARKERS = [ACCEPT_ALL_MARKER, REFUSE_MARKER, INCOMPLETE_MARKER, CONTINUE_MARKER] as const;
/** Instructions the app sends when the user starts planning; the AI speaks first in reply. */
export const KICKOFF = { scratch: '【开始规划 · 从零开始制卡】', refine: '【开始规划 · 完善优化卡】' } as const;
/** The first line of the app's request for a handoff summary; the AI writes one only after this. */
export const HANDOFF_REQUEST = '【换对话 · 请写交接摘要】';

/** The whole request: the marker, then the format, so the reply parses even if the section rules were edited. */
export function handoffRequestText(): string {
  return [
    HANDOFF_REQUEST,
    '应用要为这个分区开一个新对话。请只写一份交接摘要，不再做别的事，严格用下面的格式：',
    '',
    '```交接摘要',
    '已定: 已经确定的决定',
    '已写: 已写的组件（名称与 uid）',
    '未完成: 还没做完的事项',
    '第一步: 新对话开始后第一件要做的事',
    '```',
    '',
    '一个字段写不下时换行，续行前面缩进两个空格。',
  ].join('\n');
}

export function isHandoffRequest(text: string): boolean {
  return normalizeNewlines(text).trim().split('\n')[0]?.trim() === HANDOFF_REQUEST;
}

export type ReplySegment = { type: 'markdown'; text: string } | { type: 'dispatch'; dispatch: DispatchParse; raw: string } | { type: 'handoff'; handoff: Handoff | null; raw: string };

/** What a reply says once its marker lines are hidden. */
export interface ReplyMarkers { text: string; hasAcceptAll: boolean; refused: boolean; incomplete: boolean; continues: boolean }

/** Hides the marker lines outside code blocks and reports which ones the reply carried; a quoted marker is left alone. */
export function stripMarkers(text: string): ReplyMarkers {
  const normalized = normalizeNewlines(text);
  const fences = findFences(normalized);
  const inFence = (offset: number) => fences.some(fence => offset >= fence.start && offset < fence.end);
  const found = new Set<string>();
  const kept: string[] = [];
  let offset = 0;
  for (const line of normalized.split('\n')) {
    const start = offset; offset += line.length + 1;
    const markers = inFence(start) ? [] : REPLY_MARKERS.filter(marker => line.includes(marker));
    if (!markers.length) { kept.push(line); continue; }
    let rest = line;
    for (const marker of markers) { found.add(marker); rest = rest.replaceAll(marker, ''); }
    if (rest.trim()) kept.push(rest);
  }
  const flags = { hasAcceptAll: found.has(ACCEPT_ALL_MARKER), refused: found.has(REFUSE_MARKER), incomplete: found.has(INCOMPLETE_MARKER), continues: found.has(CONTINUE_MARKER) };
  return found.size ? { text: kept.join('\n').trimEnd(), ...flags } : { text, ...flags };
}

/**
 * A reply still being written can stop half way through a marker line (`<!-- cardwright:co`). That start is left off until
 * the marker is whole, so it does not show for a moment before `stripMarkers` hides it. Only the very end of the text
 * counts, and a whole marker is `stripMarkers`' to hide.
 */
export function hidePartialMarker(text: string): string {
  let cut = 0;
  for (const marker of REPLY_MARKERS) {
    // The longest start of this marker the text ends with, two characters (`<!`) at the least.
    for (let length = marker.length - 1; length > Math.max(cut, 1); length--) {
      if (text.endsWith(marker.slice(0, length))) { cut = length; break; }
    }
  }
  return cut ? text.slice(0, -cut).trimEnd() : text;
}

export function isKickoff(text: string): 'scratch' | 'refine' | null {
  const first = normalizeNewlines(text).trim().split('\n')[0]?.trim();
  return first === KICKOFF.scratch ? 'scratch' : first === KICKOFF.refine ? 'refine' : null;
}

export function segmentReply(text: string): ReplySegment[] {
  const normalized = normalizeNewlines(text);
  const segments: ReplySegment[] = [];
  const pushMarkdown = (value: string) => { const trimmed = value.trim(); if (trimmed) segments.push({ type: 'markdown', text: trimmed }); };
  let cursor = 0;
  for (const fence of findFences(normalized)) {
    const kind = fenceKind(fence);
    if (kind !== DISPATCH_FENCE && kind !== HANDOFF_FENCE) continue;
    pushMarkdown(normalized.slice(cursor, fence.start));
    const raw = normalized.slice(fence.start, fence.end).trimEnd();
    segments.push(kind === DISPATCH_FENCE ? { type: 'dispatch', dispatch: parseDispatchContent(fence.content), raw } : { type: 'handoff', handoff: parseHandoffContent(fence.content), raw });
    cursor = fence.end;
  }
  pushMarkdown(normalized.slice(cursor));
  return segments;
}
