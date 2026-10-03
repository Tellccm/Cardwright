export interface Box { left: number; top: number; right: number; bottom: number }
export interface Size { width: number; height: number }
export interface Placement { left: number; top: number; side: 'above' | 'below' }

/**
 * Where a floating menu goes beside the button that opened it, in window coordinates.
 *
 * It opens above the button, as popovers here always have, and drops below when the room above is too small. It lines
 * up with the button's left or right edge and slides sideways to stay `margin` inside the window. When neither side has
 * room it takes the roomier side and is pushed inside the window, over its button, rather than being cut off.
 */
export function placePopover(anchor: Box, panel: Size, viewport: Size, { align = 'left', gap = 8, margin = 8 }: { align?: 'left' | 'right'; gap?: number; margin?: number } = {}): Placement {
  const inside = (start: number, size: number, room: number) => Math.max(margin, Math.min(start, room - margin - size));
  const roomAbove = anchor.top - gap - margin;
  const roomBelow = viewport.height - margin - anchor.bottom - gap;
  const side = panel.height <= roomAbove || roomAbove >= roomBelow ? 'above' : 'below';
  return {
    left: inside(align === 'right' ? anchor.right - panel.width : anchor.left, panel.width, viewport.width),
    top: inside(side === 'above' ? anchor.top - gap - panel.height : anchor.bottom + gap, panel.height, viewport.height),
    side,
  };
}
