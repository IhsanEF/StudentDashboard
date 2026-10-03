import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { ActiveFocusState } from '../types';
import { useTasksContext } from './useTasks';

const FocusClockContext = createContext<{ activeFocus: ActiveFocusState | null } | undefined>(undefined);

// Only subscribers to this clock render each second. The dashboard context holds transitions.
export function FocusClockProvider({ activeFocus, children }: { activeFocus: ActiveFocusState | null; children: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!activeFocus?.isRunning) return;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [activeFocus?.isRunning]);

  const value = useMemo(() => ({
    activeFocus: activeFocus?.isRunning && activeFocus.endsAt
      ? { ...activeFocus, secondsLeft: Math.max(0, Math.round((activeFocus.endsAt - Math.max(now, Date.now())) / 1000)) }
      : activeFocus
  }), [activeFocus, now]);
  return <FocusClockContext.Provider value={value}>{children}</FocusClockContext.Provider>;
}

export function useFocusTimerContext() {
  const tasks = useTasksContext();
  const clock = useContext(FocusClockContext);
  return { ...tasks, activeFocus: clock ? clock.activeFocus : tasks.activeFocus };
}
