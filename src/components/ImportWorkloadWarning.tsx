import React from 'react';
import { Task } from '../types';
import { getImportWorkloadWarnings } from '../services/workloadService';

export default function ImportWorkloadWarning({ existingTasks, selectedTasks, thresholdHours }: {
  existingTasks: Task[];
  selectedTasks: Task[];
  thresholdHours: number;
}) {
  const warnings = getImportWorkloadWarnings(existingTasks, selectedTasks, thresholdHours);
  if (!warnings.length) return null;
  return (
    <div role="status" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-xs space-y-1">
      <p className="font-bold">Workload crunch warning</p>
      {warnings.map(w => (
        <p key={w.weekLabel}>{w.weekLabel}: importing the selected tasks brings your workload to {w.newTotalHours}h, exceeding your {w.threshold}h weekly limit.</p>
      ))}
    </div>
  );
}
