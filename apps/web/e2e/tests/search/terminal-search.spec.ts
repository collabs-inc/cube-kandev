// Terminal panel search — xterm addon-search integration.
import { test, expect } from "../../fixtures/test-base";
import {
  openPanelSearch,
  closePanelSearch,
  panelSearchBar,
  panelSearchInput,
  panelSearchMatchCounter,
  panelSearchToggle,
} from "../../helpers/panel-search";
import { SessionPage } from "../../pages/session-page";
import { seedTask, seedMessagesDescription } from "./shared";

/** Wait until the terminal xterm buffer contains the given text. */
async function waitForTerminalText(
  page: import("@playwright/test").Page,
  text: string,
  timeout = 15_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((needle: string) => {
          const panel = document.querySelector('[data-testid="terminal-panel"]');
          const xtermEl = panel?.querySelector(".xterm");
          type XC = HTMLElement & { __xtermReadBuffer?: () => string };
          const container = xtermEl?.parentElement as XC | null | undefined;
          return (container?.__xtermReadBuffer?.() ?? "").includes(needle);
        }, text),
      { timeout, message: `Waiting for terminal to contain "${text}"` },
    )
    .toBe(true);
}

/** Wait for the shell prompt, not only the WebSocket connection overlay. */
async function waitForTerminalShell(page: import("@playwright/test").Page): Promise<void> {
  const xterm = page.locator('[data-testid="terminal-panel"]:visible .xterm').first();
  await expect(xterm).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        xterm.evaluate((element) => {
          type XC = HTMLElement & { __xtermReadBuffer?: () => string };
          const container = element.parentElement as XC | null;
          return (container?.__xtermReadBuffer?.() ?? "").trim().length > 0;
        }),
      { timeout: 60_000, message: "Waiting for terminal shell to connect" },
    )
    .toBe(true);
}

/** Seed terminal content: types a loop producing many "hello world N" lines. */
async function seedTerminalOutput(
  session: SessionPage,
  page: import("@playwright/test").Page,
): Promise<void> {
  await session.expectTerminalConnected(60_000);
  await waitForTerminalShell(page);
  await session.typeInTerminal(`for i in 1 2 3 4 5 6 7 8 9 10; do echo "hello world $i"; done`);
  await waitForTerminalText(page, "hello world 10");
}

test.describe("@search terminal panel search", () => {
  test.describe.configure({ retries: 1 });

  test("T1+T2 Ctrl+F opens bar; matching query updates counter", async ({
    testPage,
    apiClient,
    seedData,
    prCapture,
  }) => {
    test.setTimeout(120_000);
    const { session } = await seedTask(testPage, apiClient, seedData, "terminal-search-basic", {
      description: seedMessagesDescription(["idle"]),
    });
    await seedTerminalOutput(session, testPage);

    const bufferBefore = await testPage.evaluate(() => {
      const panel = document.querySelector('[data-testid="terminal-panel"]');
      const xtermEl = panel?.querySelector(".xterm");
      type XC = HTMLElement & { __xtermReadBuffer?: () => string };
      const container = xtermEl?.parentElement as XC | null | undefined;
      return container?.__xtermReadBuffer?.() ?? "";
    });

    await openPanelSearch(testPage, "terminal");

    // Xterm should not have received a literal "f" — buffer is unchanged.
    const bufferAfter = await testPage.evaluate(() => {
      const panel = document.querySelector('[data-testid="terminal-panel"]');
      const xtermEl = panel?.querySelector(".xterm");
      type XC = HTMLElement & { __xtermReadBuffer?: () => string };
      const container = xtermEl?.parentElement as XC | null | undefined;
      return container?.__xtermReadBuffer?.() ?? "";
    });
    expect(bufferAfter).toBe(bufferBefore);

    await prCapture.startRecording("terminal-search");
    await panelSearchInput(testPage).fill("hello world");
    await expect
      .poll(async () => (await panelSearchMatchCounter(testPage).innerText()).trim(), {
        timeout: 8_000,
        message: "Waiting for match counter to reflect matches",
      })
      .toMatch(/^[1-9]\d* \/ [1-9]\d*$/);
    await prCapture.stopRecording({ caption: "Terminal search: incremental match highlighting" });
  });

  test("T4 case sensitivity toggle affects matches", async ({ testPage, apiClient, seedData }) => {
    test.setTimeout(120_000);
    const { session } = await seedTask(testPage, apiClient, seedData, "terminal-search-case", {
      description: seedMessagesDescription(["idle"]),
    });
    await seedTerminalOutput(session, testPage);

    await openPanelSearch(testPage, "terminal");
    await panelSearchInput(testPage).fill("HELLO");
    await expect
      .poll(async () => (await panelSearchMatchCounter(testPage).innerText()).trim(), {
        timeout: 8_000,
      })
      .toMatch(/^[1-9]\d* \/ [1-9]\d*$/);

    // Enable case-sensitive — "HELLO" should no longer match lowercase output
    await panelSearchToggle(testPage, "Match case").click();
    await expect
      .poll(async () => (await panelSearchMatchCounter(testPage).innerText()).trim(), {
        timeout: 8_000,
      })
      .toBe("0 / 0");
  });

  test("T5+T6 regex toggle: valid + invalid patterns", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(120_000);
    const { session } = await seedTask(testPage, apiClient, seedData, "terminal-search-regex", {
      description: seedMessagesDescription(["idle"]),
    });
    await seedTerminalOutput(session, testPage);

    await openPanelSearch(testPage, "terminal");
    await panelSearchToggle(testPage, "Regular expression").click();
    await panelSearchInput(testPage).fill("hello world \\d+");
    await expect
      .poll(async () => (await panelSearchMatchCounter(testPage).innerText()).trim(), {
        timeout: 8_000,
      })
      .toMatch(/^[1-9]\d* \/ [1-9]\d*$/);

    // Invalid regex surfaces an error
    await panelSearchInput(testPage).fill("[unclosed");
    await expect(panelSearchBar(testPage).getByText("Invalid regex")).toBeVisible({
      timeout: 3_000,
    });
    await expect(panelSearchInput(testPage)).toHaveAttribute("aria-invalid", "true");
  });

  test("T8 Escape inside terminal closes bar without leaking Esc to PTY", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(120_000);
    const { session } = await seedTask(testPage, apiClient, seedData, "terminal-search-esc", {
      description: seedMessagesDescription(["idle"]),
    });
    await seedTerminalOutput(session, testPage);

    // Capture buffer snapshot before opening search
    const getBuffer = () =>
      testPage.evaluate(() => {
        const panel = document.querySelector('[data-testid="terminal-panel"]');
        const xtermEl = panel?.querySelector(".xterm");
        type XC = HTMLElement & { __xtermReadBuffer?: () => string };
        const container = xtermEl?.parentElement as XC | null | undefined;
        return container?.__xtermReadBuffer?.() ?? "";
      });
    await openPanelSearch(testPage, "terminal");
    const beforeEsc = await getBuffer();
    await closePanelSearch(testPage);
    const afterEsc = await getBuffer();
    // Buffer should be identical — Esc did not produce any terminal output
    expect(afterEsc).toBe(beforeEsc);
  });

  test("T11 Backspace in query adjusts match counter", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(120_000);
    const { session } = await seedTask(testPage, apiClient, seedData, "terminal-search-backspace", {
      description: seedMessagesDescription(["idle"]),
    });
    await seedTerminalOutput(session, testPage);

    await openPanelSearch(testPage, "terminal");
    await panelSearchInput(testPage).fill("hello world zzz");
    await expect
      .poll(async () => (await panelSearchMatchCounter(testPage).innerText()).trim(), {
        timeout: 8_000,
      })
      .toBe("0 / 0");
    // Remove the trailing " zzz" so query becomes "hello world" and matches appear
    await panelSearchInput(testPage).fill("hello world");
    await expect
      .poll(async () => (await panelSearchMatchCounter(testPage).innerText()).trim(), {
        timeout: 8_000,
      })
      .toMatch(/^[1-9]\d* \/ [1-9]\d*$/);
  });
});
