import { useTasksContext, ToastItem } from './useTasks';

export type { ToastItem };

export function useToast() {
  const { showToast, toast, dismissToast } = useTasksContext();
  return { showToast, toast, dismissToast };
}
