import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { placePopover, type Box } from '../src/renderer/popover-position.ts';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const menu = { width: 320, height: 297 };

// The model button in the card project's right column (1333 × 893 window): the menu used to open leftwards past the
// column's edge and lose everything but its chevrons.
test('a menu with room above opens above its button, right edges lined up', () => {
  assert.deepEqual(placePopover(box(1116, 389, 1200, 417), menu, { width: 1333, height: 893 }, { align: 'right' }), { left: 880, top: 84, side: 'above' });
});

// The kickoff picker near the top of the middle column: above, it ran past the window's top edge.
test('a menu without room above drops below its button', () => {
  assert.deepEqual(placePopover(box(506, 276, 590, 304), menu, { width: 1000, height: 670 }, { align: 'right' }), { left: 270, top: 312, side: 'below' });
});

// The 一键制作 dialog at 1000 × 670: lined up with its button, the menu started 12 px left of the window.
test('a menu slides sideways to stay inside the window', () => {
  assert.equal(placePopover(box(218, 368, 308, 400), menu, { width: 1000, height: 670 }, { align: 'right' }).left, 8);
  assert.equal(placePopover(box(900, 500, 980, 530), menu, { width: 1000, height: 670 }).left, 1000 - 8 - 320);
  assert.equal(placePopover(box(40, 500, 120, 530), menu, { width: 1000, height: 670 }).left, 40);
});

test('with room on neither side the menu takes the roomier one and stays inside the window', () => {
  const tall = { width: 320, height: 500 };
  const nearTop = placePopover(box(400, 200, 480, 230), tall, { width: 1000, height: 640 }, { align: 'right' });
  assert.equal(nearTop.side, 'below');
  assert.equal(nearTop.top, 640 - 8 - 500);
  const nearBottom = placePopover(box(400, 420, 480, 450), tall, { width: 1000, height: 640 }, { align: 'right' });
  assert.equal(nearBottom.side, 'above');
  assert.equal(nearBottom.top, 8);
});

test('a menu bigger than the window is pinned to its top left margin', () => {
  assert.deepEqual(placePopover(box(400, 330, 480, 360), { width: 1200, height: 900 }, { width: 1000, height: 640 }), { left: 8, top: 8, side: 'above' });
});

test('the gap and the window margin can be chosen', () => {
  assert.deepEqual(placePopover(box(100, 400, 180, 430), { width: 200, height: 100 }, { width: 1000, height: 640 }, { gap: 4, margin: 16 }), { left: 100, top: 296, side: 'above' });
  assert.equal(placePopover(box(4, 400, 84, 430), { width: 200, height: 100 }, { width: 1000, height: 640 }, { margin: 16 }).left, 16);
});

// Every place the model picker sits (composer, right column, run and change dialogs, settings) gets the fix, because the
// menu itself floats; a scrolling column or a dialog can no longer clip it.
test('the model menu floats in the top layer and is placed by placePopover', () => {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(`../src/renderer/${file}`, import.meta.url)), 'utf8');
  assert.ok(/<Popover\b[^>]*\bfloating\b/.test(read('ModelPicker.tsx')), 'ModelPicker opens a floating Popover');
  const primitives = read('primitives.tsx');
  assert.ok(primitives.includes("popover={floating ? 'manual' : undefined}"), 'a floating panel is a manual popover');
  assert.ok(primitives.includes('showPopover()'), 'a floating panel is shown in the top layer');
  assert.ok(primitives.includes('placePopover('), 'a floating panel is placed by placePopover');
});
