import type { ComponentProps } from 'react';
import type { Components } from 'react-markdown';
import { useApp } from '../context';
import { Markdown as KernelMarkdown } from '../conversation/Markdown';

/** A web address opens in the browser; any other link stays text. */
function StudioLink({ children, href }: ComponentProps<'a'>) {
  const { api, run } = useApp();
  return href && /^https?:\/\//i.test(href)
    ? <a href={href} onClick={event => { event.preventDefault(); void run(() => api.openExternal(href)); }}>{children}</a>
    : <span>{children}</span>;
}

/** The studio skin of the conversation kernel: plain GFM, its own links; code blocks and tables are the kernel's. */
export const STUDIO_MARKDOWN = { skin: 'studio' as const, components: { a: StudioLink } satisfies Components };

/** A reply or a member's text in the studio's own look; the section thread and the squad area both draw with it. */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return <KernelMarkdown text={text} streaming={streaming} {...STUDIO_MARKDOWN} />;
}
