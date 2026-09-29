import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import { createAppStore, type AppState } from "@/lib/state/store";
import { querySidebarTasks } from "@/lib/api/domains/kanban-api";
import { selectSidebarStoreTasks } from "./use-sidebar-store-tasks";
import { useWorkspaceSidebarTasks } from "./use-workspace-sidebar-tasks";
import { DEFAULT_VIEW } from "@/lib/state/slices/ui/sidebar-view-builtins";

let store: ReturnType<typeof createAppStore>;
vi.mock("@/components/state-provider", () => ({
  useAppStore: (selector: (state: AppState) => unknown) => useStore(store, selector),
  useAppStoreApi: () => store,
}));
vi.mock("@/lib/api/domains/kanban-api", () => ({ querySidebarTasks: vi.fn() }));
vi.mock("@/hooks/use-foreground-refresh", () => ({ useForegroundRefresh: vi.fn() }));

function task(id: string): AppState["kanban"]["tasks"][number] {
  return {
    id,
    workspaceId: "ws-1",
    workflowId: "wf-1",
    workflowStepId: "step-1",
    title: id,
    position: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createAppStore();
  store.setState((state) => {
    state.workspaces.activeId = "ws-1";
    state.workspaceContextRead.workspaceId = "ws-1";
    state.workspaceContextRead.generation = state.workspaceContextGeneration;
    state.workflows.items = [{ id: "wf-1", workspaceId: "ws-1", name: "Workflow" }];
    state.kanbanMulti.snapshots["wf-1"] = {
      workflowId: "wf-1",
      workflowName: "Workflow",
      steps: [],
      tasks: [task("a"), task("b")],
    };
  });
  vi.mocked(querySidebarTasks).mockResolvedValue({
    query_key: "large",
    page: 1,
    page_size: 100,
    total_entries: 101,
    total_tasks: 101,
    total_visible_tasks: 101,
    has_next: true,
    has_previous: false,
    entries: [],
  });
});
afterEach(cleanup);

describe("complete sidebar store inventory", () => {
  it("reuses current snapshots but rejects a mixed complete and missing workflow inventory", () => {
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")?.map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    store.setState((state) => {
      state.workflows.items.push({ id: "wf-2", workspaceId: "ws-1", name: "Missing" });
    });
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")).toBeNull();
  });

  it.each(["isPlaceholder", "fetchFailed"] as const)("rejects %s snapshots", (flag) => {
    store.setState((state) => {
      state.kanbanMulti.snapshots["wf-1"][flag] = true;
    });
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")).toBeNull();
  });

  it("does not reuse another workspace, generation or denied context", () => {
    expect(selectSidebarStoreTasks(store.getState(), "ws-2")).toBeNull();
    store.setState((state) => {
      state.workspaceContextGeneration += 1;
    });
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")).toBeNull();
    store.setState((state) => {
      state.workspaceContextRead.generation = state.workspaceContextGeneration;
      state.workspaceContextRead.errors.workflows = "access_denied";
    });
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")).toBeNull();
  });

  it("does not treat a foreign task as a complete empty inventory", () => {
    store.setState((state) => {
      state.kanbanMulti.snapshots["wf-1"].tasks[0].workspaceId = "ws-2";
    });
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")).toBeNull();
  });

  it("rejects cached tasks after authenticated access is lost", () => {
    store.setState((state) => {
      state.auth = { mode: "enabled", authenticated: false, user: null };
    });
    expect(selectSidebarStoreTasks(store.getState(), "ws-1")).toBeNull();
  });
});

describe("shared sidebar task state", () => {
  it("keeps archived views on the bounded server path", async () => {
    store.setState((state) => {
      state.sidebarViewsByWorkspace["ws-1"] = {
        views: [
          {
            ...DEFAULT_VIEW,
            filters: [{ id: "archive", dimension: "archived", op: "is", value: true }],
          },
        ],
        activeViewId: DEFAULT_VIEW.id,
        draft: null,
        syncError: null,
      };
    });
    const hook = renderHook(() => useWorkspaceSidebarTasks("ws-1"));
    await waitFor(() => expect(hook.result.current.page.response?.query_key).toBe("large"));
    expect(querySidebarTasks).toHaveBeenCalledTimes(1);
    expect(hook.result.current.pageEntries).toEqual([]);
    expect(hook.result.current.allTasks).toEqual([]);
  });

  it("renders immediately, tracks live changes and never queries or accumulates page responses", () => {
    const hook = renderHook(() => useWorkspaceSidebarTasks("ws-1"));
    expect(hook.result.current.allTasks.map((row) => row.id)).toEqual(["a", "b"]);
    expect(hook.result.current.pageEntries).toBeUndefined();
    expect(hook.result.current.page.response).toBeNull();
    expect(hook.result.current.isLoading).toBe(false);
    act(() =>
      store.setState((state) => {
        state.kanbanMulti.snapshots["wf-1"].tasks = [{ ...task("b"), title: "Updated live" }];
        state.sidebarArchivedTasks.revisionByWorkspaceId["ws-1"] = 1;
      }),
    );
    expect(hook.result.current.allTasks.map((row) => row.title)).toEqual(["Updated live"]);
    expect(querySidebarTasks).not.toHaveBeenCalled();
  });

  it("uses shared state at 100 tasks and returns to bounded paging at 101", async () => {
    store.setState((state) => {
      state.kanbanMulti.snapshots["wf-1"].tasks = Array.from({ length: 100 }, (_, i) =>
        task(String(i)),
      );
    });
    const hook = renderHook(() => useWorkspaceSidebarTasks("ws-1"));
    expect(hook.result.current.allTasks).toHaveLength(100);
    expect(querySidebarTasks).not.toHaveBeenCalled();
    act(() =>
      store.setState((state) => {
        state.kanbanMulti.snapshots["wf-1"].tasks.push(task("101"));
      }),
    );
    await waitFor(() => expect(querySidebarTasks).toHaveBeenCalledTimes(1));
    expect(querySidebarTasks).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ page_size: 100 }),
      expect.anything(),
    );
    await waitFor(() => expect(hook.result.current.page.response?.query_key).toBe("large"));
    act(() =>
      store.setState((state) => {
        state.kanbanMulti.snapshots["wf-1"].tasks.pop();
      }),
    );
    expect(hook.result.current.allTasks).toHaveLength(100);
    expect(hook.result.current.page.response).toBeNull();
  });
});
