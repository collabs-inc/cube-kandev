import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/components/state-provider";
import { useEffectiveSidebarView } from "@/hooks/domains/sidebar/use-effective-sidebar-view";
import { aggregateSidebarTasks } from "@/components/task/task-session-sidebar-aggregate";
import { viewRequiresArchivedTasks } from "@/lib/sidebar/apply-view";
import type { AppState } from "@/lib/state/store";

type SidebarInventory = Pick<
  AppState,
  | "workspaces"
  | "workflows"
  | "kanbanMulti"
  | "kanban"
  | "workspaceContextRead"
  | "workspaceContextGeneration"
  | "auth"
>;

function hasCurrentSidebarContext(state: SidebarInventory, workspaceId: string | null) {
  if (!workspaceId || state.workspaces.activeId !== workspaceId) return false;
  if (state.auth.mode !== "disabled" && !state.auth.authenticated) return false;
  const read = state.workspaceContextRead;
  return (
    read.workspaceId === workspaceId &&
    read.generation === state.workspaceContextGeneration &&
    read.snapshotError !== "access_denied" &&
    !Object.values(read.errors).includes("access_denied")
  );
}

/** Missing or partial snapshots never establish a complete sidebar inventory. */
export function selectSidebarStoreTasks(state: SidebarInventory, workspaceId: string | null) {
  if (!hasCurrentSidebarContext(state, workspaceId)) return null;
  const workflows = state.workflows.items.filter(
    (workflow) => workflow.workspaceId === workspaceId,
  );
  if (workflows.length === 0) return null;
  const snapshots: AppState["kanbanMulti"]["snapshots"] = {};
  let count = 0;
  for (const workflow of workflows) {
    const snapshot = state.kanbanMulti.snapshots[workflow.id];
    if (!snapshot || snapshot.isPlaceholder || snapshot.fetchFailed) return null;
    if (snapshot.tasks.some((task) => task.workspaceId && task.workspaceId !== workspaceId))
      return null;
    count += snapshot.tasks.length;
    if (count > 100) return null;
    snapshots[workflow.id] = snapshot;
  }
  const activeWorkflowId = state.kanban.workflowId;
  const tasks = aggregateSidebarTasks(
    snapshots,
    activeWorkflowId && snapshots[activeWorkflowId] ? activeWorkflowId : null,
    state.kanban.tasks,
    state.kanban.steps,
  ).allTasks.filter(
    (task) =>
      (!task.workspaceId || task.workspaceId === workspaceId) &&
      !task.isArchived &&
      task.origin !== "automation_run",
  );
  return tasks.length <= 100 ? tasks : null;
}

export function useSidebarStoreTasks(workspaceId: string | null) {
  const view = useEffectiveSidebarView(workspaceId);
  const archived = viewRequiresArchivedTasks(view);
  const inventory = useAppStore(
    useShallow((state) => ({
      workspaces: state.workspaces,
      workflows: state.workflows,
      kanbanMulti: state.kanbanMulti,
      kanban: state.kanban,
      workspaceContextRead: state.workspaceContextRead,
      workspaceContextGeneration: state.workspaceContextGeneration,
      auth: state.auth,
    })),
  );
  return useMemo(
    () => (archived ? null : selectSidebarStoreTasks(inventory, workspaceId)),
    [archived, inventory, workspaceId],
  );
}
