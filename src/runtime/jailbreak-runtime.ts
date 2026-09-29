import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { AssembledJailbreak } from '../shared/jailbreak.ts';

/**
 * Places a 破限 pack's conversational entries into every request.
 *
 * The system entries travel with the system prompt (see `resources.ts`). The
 * opening exchange and the tail belong to the conversation, and they are added
 * here, at request time, rather than written into the session: turning the
 * toggle off then removes them completely and leaves no trace in the saved
 * history. The cost is that flipping the toggle rebuilds the prompt cache once.
 *
 * The hook never mutates the agent's own array; it returns a new one, so the
 * entries cannot accumulate across the calls of a single turn.
 */
export function createJailbreakExtension(current: () => AssembledJailbreak | undefined): ExtensionFactory {
  return pi => {
    pi.on('context', event => {
      const jailbreak = current();
      if (!jailbreak) return undefined;
      const messages = [
        // A fixed timestamp keeps the prefix byte-identical between requests.
        // An assistant turn must also carry a stop reason and a usage of its own:
        // the runtime walks these messages and reads `usage` without checking it
        // is there, and an opening line costs nothing because it is re-sent every
        // time rather than generated.
        ...jailbreak.opening.map(message => ({
          role: message.role,
          // Content parts, as the session stores them; a bare string is accepted
          // on the wire but the agent's own bookkeeping walks the parts.
          content: [{ type: 'text', text: message.content }],
          timestamp: 0,
          ...(message.role === 'assistant' ? { stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, api: 'openai-completions', provider: 'cardwright', model: 'cardwright-jailbreak' } : {}),
        })),
        ...event.messages,
      ] as typeof event.messages;
      if (!jailbreak.tail) return { messages };

      // The tail rides on the newest user message. Appending a message of its
      // own would break the user/assistant alternation in the middle of a tool
      // loop, and a provider may refuse the request outright.
      let index = -1;
      for (let position = messages.length - 1; position >= 0; position--) {
        const message = messages[position] as { role?: unknown };
        if (message?.role === 'user') { index = position; break; }
      }
      if (index < 0) return { messages };
      const target = messages[index] as { role: string; content: unknown; timestamp?: number };
      const content = typeof target.content === 'string'
        ? `${target.content}\n\n${jailbreak.tail}`
        : Array.isArray(target.content)
          ? [...target.content, { type: 'text', text: jailbreak.tail }]
          : target.content;
      messages[index] = { ...target, content } as typeof messages[number];
      return { messages };
    });
  };
}
