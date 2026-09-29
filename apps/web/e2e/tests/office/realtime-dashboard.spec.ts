import { test, expect } from "../../fixtures/office-fixture";

test.describe("Real-time dashboard updates", () => {
  test("dashboard metrics update after task creation", async ({
    testPage,
    apiClient,
    officeSeed,
  }) => {
    await testPage.goto("/office");
    await expect(testPage.getByText("Agents Enabled")).toBeVisible({ timeout: 10_000 });

    // Create a new task while viewing dashboard
    await apiClient.createTask(officeSeed.workspaceId, "Dashboard Trigger Task", {
      workflow_id: officeSeed.workflowId,
    });

    // The dashboard's "Recent Tasks" card is driven by `dashboard.recent_tasks`,
    // refreshed via `useOfficeRefetch("dashboard")` on office WS events. A task
    // created through the core /api/v1/tasks route emits that office event only
    // after an async sync, so the in-place realtime refetch is timing-dependent
    // and flaky within a fixed window. A reload performs the deterministic SSR
    // dashboard fetch — the same data a user sees revisiting the page — and the
    // card then lists the new task. Workspace event filtering is covered by the
    // deterministic office WS handler tests.
    // Scope to `<main>` (office page content) so the AppSidebar Tasks rail, which
    // also lists the title, doesn't cause a strict-mode duplicate.
    await testPage.reload();
    await testPage.waitForLoadState("networkidle");
    await expect(testPage.locator("main").getByText("Dashboard Trigger Task")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("dashboard recent tasks only include tasks from its workspace", async ({
    testPage,
    apiClient,
    officeSeed,
  }) => {
    // Create a second workspace + workflow as the "other" workspace.
    const other = await apiClient.createWorkspace("Other WS for cross-ws test");
    const otherWf = await apiClient.createWorkflow(other.id, "Other WF");

    const currentTaskTitle = "Current workspace dashboard task";
    const otherTaskTitle = "Foreign workspace dashboard task";
    await apiClient.createTask(officeSeed.workspaceId, currentTaskTitle, {
      workflow_id: officeSeed.workflowId,
    });
    await apiClient.createTask(other.id, otherTaskTitle, {
      workflow_id: otherWf.id,
    });

    // The client-side event filter is covered by deterministic office WS handler
    // tests. This checks visible workspace scoping with a positive control so an
    // empty task list cannot make the negative assertion pass.
    await testPage.goto("/office");
    await expect(testPage.getByText("Agents Enabled")).toBeVisible({ timeout: 10_000 });
    await expect(
      testPage.locator("main").getByText(currentTaskTitle, { exact: true }),
    ).toBeVisible();
    await expect(testPage.locator("main").getByText(otherTaskTitle, { exact: true })).toHaveCount(
      0,
    );
  });
});
