import type { ChatMessage, Task, ToolCall } from './types.ts';
import { tokenTotals } from './usage.ts';

/**
 * A conversation as a Markdown document: the messages in order, the thinking
 * that produced them, and the tool calls with their results.
 *
 * It is written for a reader, not for re-import. Tool output is fenced and
 * truncated at a generous limit, because a transcript that cannot be opened is
 * not a transcript. Nothing is redacted here beyond that limit: the caller owns
 * the file, and the desktop process redacts credentials before anything reaches
 * a task in the first place.
 */

const LIMIT = 20_000;

function fence(text: string, language = ''): string {
  // A body containing a fence needs a longer one around it.
  const longest = [...text.matchAll(/^`{3,}/gm)].reduce((most, match) => Math.max(most, match[0].length), 2);
  const rail = '`'.repeat(Math.max(3, longest + 1));
  return `${rail}${language}\n${text}\n${rail}`;
}

function clip(text: string): string {
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT)}\n… ${text.length - LIMIT} more characters`;
}

function when(value: string | undefined): string {
  if (!value) return '';
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at.toLocaleString() : value;
}

function toolSection(tool: ToolCall): string[] {
  const lines = [`<summary><strong>${tool.name}</strong> · ${tool.status}</summary>`, ''];
  const args = JSON.stringify(tool.args ?? {}, null, 2);
  if (args && args !== '{}') lines.push('Arguments:', '', fence(clip(args), 'json'), '');
  if (tool.output?.trim()) lines.push('Result:', '', fence(clip(tool.output)), '');
  if (tool.patch?.trim()) lines.push('Changes:', '', fence(clip(tool.patch), 'diff'), '');
  return ['<details>', ...lines, '</details>', ''];
}

export interface TranscriptOptions {
  /** Chapter markers the agent set, rendered as headings. */
  chapters?: Task['chapters'];
  projectName?: string;
  gatewayName?: string;
}

export function buildTranscript(task: Pick<Task, 'title' | 'messages' | 'tools' | 'createdAt' | 'updatedAt' | 'modelId' | 'cwd'>, options: TranscriptOptions = {}): string {
  const usage = task.messages.reduce((total, message) => total + tokenTotals(message.usage).total, 0);
  const out: string[] = [
    `# ${task.title}`,
    '',
    '| | |',
    '| --- | --- |',
    ...(options.projectName ? [`| Project | ${options.projectName} |`] : []),
    `| Folder | \`${task.cwd}\` |`,
    ...(task.modelId ? [`| Model | ${task.modelId}${options.gatewayName ? ` (${options.gatewayName})` : ''} |`] : []),
    `| Started | ${when(task.createdAt)} |`,
    `| Updated | ${when(task.updatedAt)} |`,
    `| Messages | ${task.messages.length} |`,
    ...(usage > 0 ? [`| Reported tokens | ${usage.toLocaleString()} |`] : []),
    '',
  ];

  const chapters = new Map((options.chapters ?? []).map(chapter => [chapter.turnId, chapter.title]));
  const byTurn = new Map<string, ToolCall[]>();
  for (const tool of task.tools) {
    const turn = tool.turnId ?? '';
    byTurn.set(turn, [...(byTurn.get(turn) ?? []), tool]);
  }
  const seen = new Set<string>();

  const label = (message: ChatMessage) => message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Cardwright' : 'System';
  for (const message of task.messages) {
    const turn = message.turnId ?? message.id;
    const chapter = chapters.get(turn);
    if (chapter && !seen.has(turn)) { out.push(`## ${chapter}`, ''); seen.add(turn); }
    out.push(`### ${label(message)}`, '');
    if (message.thinking?.trim()) out.push('<details>', '<summary>Thinking</summary>', '', fence(clip(message.thinking)), '</details>', '');
    if (message.text?.trim()) out.push(clip(message.text), '');
    const tools = byTurn.get(turn);
    if (tools?.length && message.role === 'assistant') {
      byTurn.delete(turn);
      for (const tool of tools) out.push(...toolSection(tool));
    }
  }
  // Tool calls whose turn never produced a visible message still belong in the record.
  for (const tools of byTurn.values()) for (const tool of tools) out.push(...toolSection(tool));

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** A file name that Windows accepts, derived from the conversation's title. */
export function transcriptFileName(title: string, at = new Date()): string {
  const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
  const safe = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Conversation';
  return `${safe} ${stamp}.md`;
}
