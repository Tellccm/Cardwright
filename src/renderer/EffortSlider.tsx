import { useMemo } from 'react';
import type { ThinkingLevel } from '../shared/types';
import { useApp } from './context';
import { thinkingLabel } from './effort';

/**
 * 思考强度 as a night sky: the further right, the more of it lights up.
 *
 * DESIGN.md keeps the workbench quiet, and this is the one deliberate exception
 * (1.2.0). The motion is opacity only, it stops under reduced motion, and the
 * loop pauses while the window is in the background like every other loop.
 *
 * A native range input carries the interaction, so arrow keys, Home/End and
 * screen readers all work without being re-implemented; the sky is drawn
 * underneath it.
 */

/** Fixed positions, so the sky does not reshuffle on every render or level change. */
const STARS = [
  [4, 62], [9, 28], [13, 76], [18, 44], [22, 18], [27, 68], [31, 36], [36, 82],
  [40, 24], [45, 58], [49, 34], [54, 74], [58, 46], [63, 20], [67, 66], [72, 38],
  [76, 80], [81, 30], [85, 60], [90, 42], [94, 70], [97, 26],
].map(([x, y], index) => ({ x, y, delay: (index % 7) * 0.42, size: index % 3 === 0 ? 2.4 : 1.6 }));

export function EffortSlider({ levels, value, onChange, disabled, recommended, footer, className = '' }: {
  levels: ThinkingLevel[];
  value: ThinkingLevel;
  onChange: (next: ThinkingLevel) => void;
  disabled?: boolean;
  /** The user's default, marked under the track. */
  recommended?: ThinkingLevel;
  footer?: React.ReactNode;
  className?: string;
}) {
  const { t } = useApp();
  const index = Math.max(0, levels.indexOf(value));
  const last = Math.max(1, levels.length - 1);
  const percent = (index / last) * 100;
  // Higher effort lights more of the sky; the lowest level still shows a few.
  const brightness = useMemo(() => 0.25 + (index / last) * 0.75, [index, last]);

  return <div className={`effort-slider ${disabled ? 'is-disabled' : ''} ${className}`} style={{ ['--effort-fill' as string]: `${percent}%`, ['--effort-glow' as string]: brightness.toFixed(3) }}>
    <div className="effort-slider-ends"><span>{t('Faster', '更快')}</span><span>{t('Smarter', '更聪明')}</span></div>
    <div className="effort-slider-track">
      {/* The capsule and its sky are clipped; the rail inside it is inset so the thumb never hangs over an end. */}
      <div className="effort-slider-fill" aria-hidden="true">
        <div className="effort-slider-sky">
          {STARS.map((star, position) => <i key={position} style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size, animationDelay: `${star.delay}s` }} />)}
        </div>
      </div>
      <div className="effort-slider-rail">
        <div className="effort-slider-ticks" aria-hidden="true">
          {levels.map((level, position) => <i key={level} className={position <= index ? 'is-lit' : ''} style={{ left: `${(position / last) * 100}%` }} />)}
        </div>
        <span className="effort-slider-thumb" aria-hidden="true" style={{ left: `${percent}%` }} />
        <input
          type="range" min={0} max={last} step={1} value={index} disabled={disabled}
          aria-label={t('Reasoning effort', '思考强度')}
          aria-valuetext={thinkingLabel(value, t)}
          onChange={event => { const next = levels[Number(event.target.value)]; if (next && next !== value) onChange(next); }}
        />
      </div>
    </div>
    {recommended && levels.includes(recommended) && <div className="effort-slider-marks" aria-hidden="true">
      <span style={{ left: `${(levels.indexOf(recommended) / last) * 100}%` }}>{t('Recommended', '推荐')}</span>
    </div>}
    {footer}
  </div>;
}
