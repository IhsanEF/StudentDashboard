import { useTasksContext } from './useTasks';

export function useViewMode() {
  const { uiPrefs, setViewMode } = useTasksContext();
  return {
    viewMode: uiPrefs.viewMode,
    isSimple: uiPrefs.viewMode === 'simple',
    isDetailed: uiPrefs.viewMode === 'detailed',
    setViewMode
  };
}
