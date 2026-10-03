import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useTasksContext } from '../hooks/useTasks';
import { getOfflineCacheStatus, subscribeOfflineCacheStatus } from '../auth';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, isDemoMode } = useTasksContext();
  const [cacheStatus, setCacheStatus] = useState(getOfflineCacheStatus);
  useEffect(() => {
    if (!isDemoMode) return subscribeOfflineCacheStatus(setCacheStatus);
  }, [isDemoMode]);

  if (isOnline) return null;

  return (
    <aside 
      role="status"
      aria-live="polite"
      className="bg-amber-50 border-b border-amber-200 px-4 md:px-8 py-2.5 flex items-center gap-2 shrink-0 text-amber-900 text-xs font-medium"
    >
      <WifiOff size={16} className="text-amber-600 shrink-0" aria-hidden="true" />
      <span>{isDemoMode
        ? "You're offline. Demo data is stored in memory and not saved."
        : cacheStatus === 'persistent'
          ? "You're offline — showing your last saved data. Changes are saved on this device and will sync when you're back online."
          : cacheStatus === 'memory'
            ? "You're offline. Device storage is unavailable. Changes are only kept in this tab; keep it open until you're back online to sync."
            : "You're offline. Checking device storage; keep this tab open until you're back online to sync."}</span>
    </aside>
  );
};
