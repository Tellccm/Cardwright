import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableEfforts, defaultEffortMap, effectiveEffort } from '../src/shared/effort.ts';
import type { Gateway } from '../src/shared/types.ts';

const gateway = (changes: Partial<Gateway> = {}): Gateway => ({
  id: 'g', name: 'G', baseUrl: 'https://example.invalid/v1', modelId: 'm', protocol: 'openai-completions',
  reasoning: true, contextWindow: 300000, maxTokens: 8192, hasKey: true, effortMap: { ...defaultEffortMap }, ...changes,
});

test('the slider offers exactly the levels the gateway supports, in order, with no off position', () => {
  const levels = availableEfforts(gateway());
  assert.deepEqual(levels, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  // The slider's position is the index in this list, so the order must be the visible order.
  assert.equal(levels.indexOf('low'), 0);
  assert.equal(levels.indexOf('ultra'), levels.length - 1);
  assert.equal(levels.includes('off' as never), false, 'a reasoning gateway never shows an off position');

  // A gateway that disables a level shortens the track rather than leaving a dead stop.
  const narrowed = availableEfforts(gateway({ effortMap: { ...defaultEffortMap, xhigh: null, max: null } }));
  assert.deepEqual(narrowed, ['low', 'medium', 'high', 'ultra']);

  // Without reasoning there is nothing to slide, and the control is not shown.
  assert.deepEqual(availableEfforts(gateway({ reasoning: false })), ['off']);
});

test('Ultra sits at the top of the track and still sends the max request value', () => {
  const resolved = effectiveEffort(gateway(), 'ultra');
  assert.equal(resolved.level, 'max');
  assert.equal(resolved.providerValue, 'max');
});

test('the slider keeps the motion promises DESIGN.md makes for it', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'effort-slider.css'), 'utf8');
  assert.match(css, /html\[data-motion="reduced"\][^}]*animation: none/, 'reduced motion stops the twinkle');
  assert.match(css, /prefers-reduced-motion: reduce/, 'the system preference is honoured too');
  assert.match(css, /html\[data-window="inactive"\][^}]*animation-play-state: paused/, 'the loop pauses in the background');
  // Only opacity and transform may animate; a keyframe on anything else would cost layout or paint.
  const keyframes = css.slice(css.indexOf('@keyframes effort-twinkle'));
  const block = keyframes.slice(0, keyframes.indexOf('\n}') + 2);
  for (const property of block.matchAll(/^\s*(?:[\d.%,\s]+\{)?\s*([a-z-]+):/gm)) {
    assert.ok(['opacity'].includes(property[1]), `the twinkle animates ${property[1]}, which is not opacity`);
  }
  // The rail is inset, so the thumb cannot hang over either end of the capsule.
  assert.match(css, /\.effort-slider-rail\s*\{[^}]*left: 13px;\s*right: 13px/);

  const component = readFileSync(join(process.cwd(), 'src', 'renderer', 'EffortSlider.tsx'), 'utf8');
  assert.match(component, /type="range"/, 'a native range carries keyboard and screen-reader behaviour');
  assert.match(component, /aria-valuetext=/, 'the level is announced by name, not by index');
});

test('DESIGN.md records the slider as the workbench’s one looping decoration', () => {
  const design = readFileSync(join(process.cwd(), 'DESIGN.md'), 'utf8');
  assert.match(design, /思考强度 slider/);
  assert.match(design, /only looping decoration/);
});
