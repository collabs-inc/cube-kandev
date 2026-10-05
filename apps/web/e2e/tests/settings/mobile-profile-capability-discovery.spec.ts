import { test, expect } from "../../fixtures/test-base";
import type { BrowserContext, Page } from "@playwright/test";
import type { PrAssetCapture } from "../../helpers/pr-asset-capture";
import {
  approveRuntimeUpdateInOtherTab,
  createProfileWithCatalog,
  installProfileRuntimeObservationFixture,
  mockProfileProbeRequiresAuth,
  observeProfileDiscoveryRequests,
  readProfileProbeEvidence,
} from "../../helpers/profile-capability-discovery";

async function expectMobileRuntimeDetails(page: Page, capture: PrAssetCapture) {
  const runtimeDetails = page.getByTestId("profile-runtime-info");
  await expect(runtimeDetails).toContainText("Host runtime");
  await expect(runtimeDetails).toContainText("Observed: 1.11.0");
  await expect(runtimeDetails).toContainText("Configured: 1.10.0");
  await expect(page.getByTestId("profile-runtime-update-status")).toHaveText(
    "A managed runtime update is available.",
  );
  await expect(runtimeDetails).toContainText("Codex CLI");
  const manage = runtimeDetails.getByRole("link", { name: "Manage bridge version" });
  const guidance = runtimeDetails.getByRole("link", { name: "Provider guidance" });
  await runtimeDetails.scrollIntoViewIfNeeded();
  const [manageBounds, guidanceBounds] = await Promise.all([
    manage.boundingBox(),
    guidance.boundingBox(),
  ]);
  expect(manageBounds?.height).toBeGreaterThanOrEqual(44);
  expect(guidanceBounds?.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs((manageBounds?.x ?? 0) - (guidanceBounds?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((manageBounds?.width ?? 0) - (guidanceBounds?.width ?? 0))).toBeLessThan(1);
  expect(guidanceBounds?.y ?? 0).toBeGreaterThan(manageBounds?.y ?? 0);
  await capture.screenshot("mobile-profile-runtime-context", {
    caption: "Mobile profile runtime details and recovery actions",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function editRuntimeDraftAndContinue(page: Page): Promise<string> {
  const selector = page.getByRole("button", { name: "Profile start model settings" });
  const selectedBefore = (await selector.textContent()) ?? "";
  await page.getByTestId("env-var-row-0").locator("input").nth(1).fill("mobile-runtime-draft");
  await expect(page.getByTestId("profile-capability-status")).toHaveAttribute(
    "data-status",
    "stale",
  );
  await page.getByRole("link", { name: "Manage bridge version" }).tap();
  const navigationGuard = page.getByRole("alertdialog", {
    name: "Save changes before leaving?",
  });
  await expect(navigationGuard).toBeVisible();
  await navigationGuard.getByRole("button", { name: "Continue editing" }).tap();
  return selectedBefore;
}

async function expectActivatedProfileDraft(
  page: Page,
  requests: ReturnType<typeof observeProfileDiscoveryRequests>,
  profileId: string,
  selectedBefore: string,
) {
  await expect(page.getByTestId("profile-capability-status")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("profile-runtime-component-bridge")).toContainText(
    "Observed: 0.63.0",
  );
  await expect(page.getByTestId("profile-runtime-update-status")).toHaveText(
    "The managed runtime is up to date.",
    { timeout: 20_000 },
  );
  await expect(page.getByRole("button", { name: "Profile start model settings" })).toHaveText(
    selectedBefore,
  );
  const refreshedProbe = requests.find(
    (request) => request.url.endsWith("/probe") && request.body.refresh === true,
  );
  expect(refreshedProbe?.body.profile_id).toBe(profileId);
  expect(refreshedProbe?.body.launch_settings).toMatchObject({
    env_vars: expect.arrayContaining([
      expect.objectContaining({
        key: "MOCK_AGENT_PROFILE_CATALOG",
        value: "mobile-runtime-draft",
      }),
    ]),
  });
}

async function expectNarrowFinePointerRuntimeAction(
  page: Page,
  agentName: string,
  profileId: string,
) {
  const browser = page.context().browser();
  if (!browser) throw new Error("Browser context is required for the fine-pointer check");
  const fineContext: BrowserContext = await browser.newContext({
    viewport: { width: 767, height: 852 },
    isMobile: false,
    hasTouch: false,
    storageState: await page.context().storageState(),
  });
  try {
    const backendPort = await page.evaluate(() => window.__KANDEV_API_PORT);
    await fineContext.addInitScript(
      ({ backendPort: apiPort }: { backendPort: string }) => {
        window.__KANDEV_API_PORT = apiPort;
      },
      { backendPort },
    );
    const finePage = await fineContext.newPage();
    await installProfileRuntimeObservationFixture(finePage);
    await finePage.goto(
      new URL(
        `/settings/agents/${agentName}/profiles/${profileId}`,
        new URL(page.url()).origin,
      ).toString(),
    );
    expect(await finePage.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
    const action = finePage.getByRole("link", { name: "Manage bridge version" });
    await expect(action).toBeVisible();
    const bounds = await action.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  } finally {
    await fineContext.close();
  }
}

test.describe("Mobile profile capability discovery", () => {
  test("shows trusted manual recovery for an external primary runtime", async ({
    testPage,
    apiClient,
    backend,
  }) => {
    const { agents } = await apiClient.listAgents();
    const agent = agents.find((item) => item.name === "mock-agent");
    if (!agent) throw new Error("mock-agent is required for profile discovery E2E");
    const { profile } = await createProfileWithCatalog(
      apiClient,
      backend,
      agent.id,
      "Mobile native runtime recovery",
      "mobile-native-runtime",
    );
    await installProfileRuntimeObservationFixture(testPage, { nativeBridge: true });

    try {
      await testPage.goto(`/settings/agents/${agent.name}/profiles/${profile.id}`);
      await expect(testPage.getByTestId("profile-capability-status")).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 20_000 },
      );

      const runtimeDetails = testPage.getByTestId("profile-runtime-info");
      await expect(runtimeDetails.getByTestId("profile-runtime-component-bridge")).toContainText(
        "External",
      );
      await expect(runtimeDetails.getByTestId("profile-runtime-component-bridge")).toContainText(
        "Managed externally",
      );
      await expect(
        runtimeDetails.getByRole("link", { name: "Manual update guidance" }),
      ).toHaveAttribute("href", "https://opencode.ai/docs/cli/");
      await expect(runtimeDetails.getByRole("link", { name: "Manage bridge version" })).toHaveCount(
        0,
      );
      await expect(testPage.getByTestId("profile-runtime-update-status")).toHaveCount(0);
      const manualGuidance = runtimeDetails.getByRole("link", {
        name: "Manual update guidance",
      });
      await manualGuidance.scrollIntoViewIfNeeded();
      expect((await manualGuidance.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(
        await testPage.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    } finally {
      await apiClient.deleteAgentProfile(profile.id, true);
    }
  });

  test("keeps configured managed fallback recovery available for an unknown prefixed launch", async ({
    testPage,
    apiClient,
    backend,
  }) => {
    const { agents } = await apiClient.listAgents();
    const agent = agents.find((item) => item.name === "mock-agent");
    if (!agent) throw new Error("mock-agent is required for profile discovery E2E");
    const { profile } = await createProfileWithCatalog(
      apiClient,
      backend,
      agent.id,
      "Mobile prefixed runtime recovery",
      "mobile-prefixed-runtime",
    );
    await installProfileRuntimeObservationFixture(testPage, { unknownManagedFallback: true });

    try {
      await testPage.goto(`/settings/agents/${agent.name}/profiles/${profile.id}`);
      await expect(testPage.getByTestId("profile-capability-status")).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 20_000 },
      );

      const runtimeDetails = testPage.getByTestId("profile-runtime-info");
      const bridge = runtimeDetails.getByTestId("profile-runtime-component-bridge");
      await expect(bridge).toContainText("Source unknown");
      await expect(bridge).toContainText("Managed by Kandev");
      await expect(bridge).toContainText("Configured: 1.10.0");
      await expect(bridge).not.toContainText("Observed:");
      await expect(testPage.getByTestId("profile-runtime-update-status")).toHaveCount(0);

      const manage = runtimeDetails.getByRole("link", { name: "Manage bridge version" });
      await expect(manage).toBeVisible();
      await manage.scrollIntoViewIfNeeded();
      expect((await manage.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(
        await testPage.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    } finally {
      await apiClient.deleteAgentProfile(profile.id, true);
    }
  });

  test("keeps runtime recovery touch-safe and refreshes the open draft after a second-tab update", async ({
    testPage,
    apiClient,
    backend,
    prCapture,
  }) => {
    test.setTimeout(120_000);

    const { agents } = await apiClient.listAgents();
    const agent = agents.find((item) => item.name === "mock-agent");
    if (!agent) throw new Error("mock-agent is required for profile discovery E2E");
    const { profile } = await createProfileWithCatalog(
      apiClient,
      backend,
      agent.id,
      "Mobile runtime observation",
      "mobile-runtime-initial",
    );
    const profileRuntime = await installProfileRuntimeObservationFixture(testPage);
    const requests = observeProfileDiscoveryRequests(testPage);
    let updatePage: Page | undefined;

    try {
      await testPage.goto(`/settings/agents/${agent.name}/profiles/${profile.id}`);
      const selector = testPage.getByRole("button", { name: "Profile start model settings" });
      await expect(selector).toBeVisible({ timeout: 15_000 });
      await expect(testPage.getByTestId("profile-capability-status")).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 20_000 },
      );

      await expectMobileRuntimeDetails(testPage, prCapture);
      const selectedBefore = await editRuntimeDraftAndContinue(testPage);

      const updateTab = await approveRuntimeUpdateInOtherTab(testPage, profileRuntime);
      updatePage = updateTab.page;
      await expectActivatedProfileDraft(testPage, requests, profile.id, selectedBefore);
      await selector.tap();
      await expect(
        testPage.getByRole("option", { name: "Profile env after update" }),
      ).toBeVisible();
      await testPage.keyboard.press("Escape");
      await expectNarrowFinePointerRuntimeAction(testPage, agent.name, profile.id);
    } finally {
      if (updatePage) await updatePage.close();
      await apiClient.deleteAgentProfile(profile.id, true);
    }
  });

  test("refreshes a launch draft through touch controls and retains the latest options", async ({
    testPage,
    apiClient,
    backend,
  }) => {
    test.setTimeout(90_000);

    const { agents } = await apiClient.listAgents();
    const agent = agents.find((item) => item.name === "mock-agent");
    if (!agent) throw new Error("mock-agent is required for profile discovery E2E");
    const { profile, evidencePath } = await createProfileWithCatalog(
      apiClient,
      backend,
      agent.id,
      "Mobile capability discovery",
      "mobile-saved",
    );
    const requests = observeProfileDiscoveryRequests(testPage);

    try {
      await testPage.goto(`/settings/agents/${agent.name}/profiles/${profile.id}`);
      const selector = testPage.getByRole("button", { name: "Profile start model settings" });
      await expect(selector).toBeVisible({ timeout: 15_000 });
      await expect(testPage.getByTestId("profile-capability-status")).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 20_000 },
      );

      await testPage.getByTestId("env-var-row-0").locator("input").nth(1).fill("mobile-draft");
      await expect(testPage.getByTestId("profile-capability-status")).toHaveAttribute(
        "data-status",
        "stale",
      );
      const refresh = testPage.getByTestId("profile-refresh-capabilities");
      const refreshBounds = await refresh.boundingBox();
      expect(refreshBounds?.height).toBeGreaterThanOrEqual(44);
      await expect(
        testPage.getByRole("button", { name: /^Save( changes)?$/i }).first(),
      ).toBeEnabled();

      await testPage.getByTestId("cli-flag-flag-0").fill("--profile-catalog=mobile-draft-cli");
      await testPage.getByTestId("profile-advanced-options-trigger").tap();
      await testPage.getByTestId("command-prefix-input").fill("mock-agent --profile-probe-wrapper");
      await refresh.tap();
      await expect(testPage.getByTestId("profile-capability-status")).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 20_000 },
      );

      await selector.tap();
      await testPage.getByRole("option", { name: "Profile env mobile-draft" }).tap();
      await expect(selector).toContainText("Profile env mobile-draft");
      await expect(testPage.getByTestId("model-config-resolution-loading")).toBeHidden({
        timeout: 15_000,
      });
      expect(
        await testPage.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);

      const resolveRequest = requests.find(
        (request) =>
          request.url.endsWith("/resolve") &&
          request.body.model === "profile-env-mobile-draft" &&
          request.body.launch_settings !== undefined,
      );
      expect(resolveRequest?.body.profile_id).toBe(profile.id);
      const probeRequest = requests.find(
        (request) => request.url.endsWith("/probe") && request.body.refresh === true,
      );
      expect(probeRequest?.body.profile_id).toBe(profile.id);
      expect(probeRequest?.body.launch_settings).toEqual({
        env_vars: [
          { key: "MOCK_AGENT_PROFILE_CATALOG", value: "mobile-draft" },
          { key: "MOCK_AGENT_PROFILE_EVIDENCE_FILE", value: evidencePath },
        ],
        cli_flags: [
          {
            description: "Profile catalog fixture",
            flag: "--profile-catalog=mobile-draft-cli",
            enabled: true,
          },
        ],
        command_prefix: "mock-agent --profile-probe-wrapper",
      });
      const evidence = readProfileProbeEvidence(evidencePath);
      expect(evidence.some((item) => item.wrapper && item.command === "mock-agent")).toBe(true);
      expect(
        evidence.some(
          (item) =>
            !item.wrapper &&
            item.env_catalog === "mobile-draft" &&
            item.cli_catalog === "mobile-draft-cli",
        ),
      ).toBe(true);
    } finally {
      await apiClient.deleteAgentProfile(profile.id, true);
    }
  });

  test("keeps authentication recovery available after a profile probe fails", async ({
    testPage,
    apiClient,
    backend,
  }) => {
    test.setTimeout(60_000);

    const { agents } = await apiClient.listAgents();
    const agent = agents.find((item) => item.name === "mock-agent");
    if (!agent) throw new Error("mock-agent is required for profile discovery E2E");
    const { profile } = await createProfileWithCatalog(
      apiClient,
      backend,
      agent.id,
      "Mobile capability auth recovery",
      "mobile-auth",
    );

    try {
      const authProbeIntercepted = await mockProfileProbeRequiresAuth(testPage, profile.id);
      await testPage.route("**/api/v1/host-shell/start", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "host shell is stubbed in this test" }),
        }),
      );
      await testPage.goto(`/settings/agents/${agent.name}/profiles/${profile.id}`);
      await expect.poll(authProbeIntercepted).toBe(true);
      await expect(testPage.getByTestId("profile-no-auth-panel")).toHaveAttribute(
        "data-status",
        "auth_required",
        { timeout: 20_000 },
      );

      const openTerminal = testPage.getByTestId("profile-no-auth-open-terminal");
      await expect(openTerminal).toBeVisible();
      const bounds = await openTerminal.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await openTerminal.tap();
      await expect(testPage.getByRole("dialog")).toBeVisible();
    } finally {
      await apiClient.deleteAgentProfile(profile.id, true);
    }
  });
});
