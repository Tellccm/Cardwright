import { useLayoutEffect, useState } from 'react';
import type { Task } from '../shared/types';
import { netStatusText } from '../shared/net-status';
import { useApp } from './context';

/** A task's 排队 / 冷却 / 重试 line; it re-renders every second while there is a time to count down. */
export function useNetStatusText(net: Task['net']): string | null {
  const { t } = useApp();
  const [now, setNow] = useState(() => Date.now());
  const until = net?.until;
  // A layout effect, so the clock is corrected before the first frame with a countdown is painted: `now` was last set
  // when the view opened, which can be long before the line first appears (a passive effect painted that stale time).
  useLayoutEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return netStatusText(net, now, t);
}
