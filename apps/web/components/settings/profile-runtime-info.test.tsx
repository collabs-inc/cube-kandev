import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, type ComponentProps, type PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentUpdateStatus } from "@/lib/api";
import { StateProvider, useAppStoreApi } from "@/components/state-provider";
import type { ProfileRuntimeInfo as RuntimeInfo } from "@/lib/types/http";
import { ProfileRuntimeInfo } from "./profile-runtime-info";

const { listStatusesMock } = vi.hoisted(() => ({ listStatusesMock: vi.fn() }));
const CLAUDE_AGENT = "claude-acp";
const CLAUDE_PACKAGE = "@agentclientprotocol/claude-agent-acp";
const MANAGE_BRIDGE_VERSION_LABEL = "Manage bridge version";
const OPENCODE_GUIDANCE_URL = "https://opencode.ai/docs/cli/";
const RUNTIME_STATUS_TEST_ID = "profile-runtime-update-status";

vi.mock("@/lib/api/domains/agent-update-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/domains/agent-update-api")>()),
  listAgentUpdateStatuses: (...args: unknown[]) => listStatusesMock(...args),
}));

const runtimeInfo: RuntimeInfo = {
  scope: "host",
  observed_at: "2026-01-01T00:00:00.000Z",
  components: [
    {
      role: "bridge",
      name: "Claude ACP bridge",
      package: CLAUDE_PACKAGE,
      source: "managed",
      owner: "kandev",
      effective_version: "1.10.0",
      observed_version: "1.11.0",
    },
    {
      role: "provider",
      name: "Codex CLI",
      package: "@openai/codex",
      source: "external",
      owner: "external",
      observed_version: "0.153.4",
      guidance_url: "https://github.com/openai/codex",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  listStatusesMock.mockResolvedValue({ statuses: [] });
});

afterEach(() => cleanup());

function renderProfileRuntimeInfo(
  props: ComponentProps<typeof ProfileRuntimeInfo>,
  statuses: Record<string, AgentUpdateStatus> = {},
) {
  return render(
    <StateProvider>
      <SeedRuntimeStatuses statuses={statuses}>
        <ProfileRuntimeInfo {...props} />
      </SeedRuntimeStatuses>
    </StateProvider>,
  );
}

function SeedRuntimeStatuses({
  statuses,
  children,
}: PropsWithChildren<{ statuses: Record<string, AgentUpdateStatus> }>) {
  const store = useAppStoreApi();
  useLayoutEffect(() => {
    store.getState().setAgentRuntimeUpdateStatuses(Object.values(statuses), Date.now());
  }, [statuses, store]);
  return children;
}

function FinishAgentUpdate({
  agentName,
  status = "succeeded",
}: {
  agentName: string;
  status?: "succeeded" | "failed";
}) {
  const store = useAppStoreApi();
  return (
    <button
      onClick={() =>
        store.getState().upsertAgentUpdateJob({
          job_id: "profile-runtime-update-1",
          agent_name: agentName,
          status,
          started_at: "2026-01-01T00:00:00.000Z",
          finished_at: "2026-01-01T00:01:00.000Z",
        })
      }
    >
      Finish update
    </button>
  );
}

it("shows observed and configured versions with managed and provider recovery", () => {
  const statuses = {
    [CLAUDE_AGENT]: {
      agent_name: CLAUDE_AGENT,
      display_name: "Claude",
      runtime_id: `managed:${CLAUDE_AGENT}`,
      owner: "kandev",
      mechanism: "npm",
      management: "managed",
      available: true,
      enabled: true,
      auto_update_supported: false,
      auto_update: false,
      package: CLAUDE_PACKAGE,
      default_version: "1.12.0",
      effective_version: "1.11.0",
      check_state: "unknown",
    },
  } satisfies Record<string, AgentUpdateStatus>;

  renderProfileRuntimeInfo(
    { agentName: CLAUDE_AGENT, discoveryState: "ready", runtimeInfo },
    statuses,
  );

  expect(screen.getByText("These details describe the runtime on this host.")).toBeTruthy();
  expect(screen.getByText("Observed: 1.11.0")).toBeTruthy();
  expect(screen.getByText("Configured: 1.10.0")).toBeTruthy();
  expect(screen.getByText("Latest runtime version is unavailable.")).toBeTruthy();
  expect(screen.queryByText("Version unknown")).toBeNull();

  const manage = screen.getByRole("link", { name: MANAGE_BRIDGE_VERSION_LABEL });
  expect(manage.getAttribute("href")).toBe(`/settings/agents#installed-agent-${CLAUDE_AGENT}`);
  const guidance = screen.getByRole("link", { name: "Provider guidance" });
  expect(guidance.getAttribute("href")).toBe("https://github.com/openai/codex");
  expect(guidance.getAttribute("target")).toBe("_blank");
});

it("shows trusted manual recovery for native OpenCode without managed-release wording", () => {
  const statuses = {
    "opencode-acp": {
      agent_name: "opencode-acp",
      display_name: "OpenCode",
      runtime_id: "managed:opencode-acp",
      owner: "kandev",
      mechanism: "npm",
      management: "managed",
      available: true,
      enabled: true,
      auto_update_supported: false,
      auto_update: false,
      package: "opencode-ai",
      default_version: "1.2.0",
      effective_version: "1.1.0",
      check_state: "update_available",
    },
  } satisfies Record<string, AgentUpdateStatus>;
  const nativeRuntime: RuntimeInfo = {
    scope: "host",
    observed_at: "2026-01-01T00:00:00.000Z",
    components: [
      {
        role: "bridge",
        name: "OpenCode",
        source: "external",
        owner: "external",
        observed_version: "1.1.0",
        guidance_url: OPENCODE_GUIDANCE_URL,
      },
    ],
  };

  renderProfileRuntimeInfo(
    { agentName: "opencode-acp", discoveryState: "ready", runtimeInfo: nativeRuntime },
    statuses,
  );

  expect(screen.getByText("External")).toBeTruthy();
  expect(screen.getByText("Managed externally")).toBeTruthy();
  expect(screen.queryByRole("link", { name: MANAGE_BRIDGE_VERSION_LABEL })).toBeNull();
  expect(screen.getByRole("link", { name: "Manual update guidance" }).getAttribute("href")).toBe(
    OPENCODE_GUIDANCE_URL,
  );
  expect(screen.queryByTestId(RUNTIME_STATUS_TEST_ID)).toBeNull();
});

it("keeps trusted manual guidance for an external runtime behind an unverified prefix", () => {
  const prefixedNativeRuntime: RuntimeInfo = {
    scope: "host",
    observed_at: runtimeInfo.observed_at,
    components: [
      {
        role: "bridge",
        name: "OpenCode",
        source: "unknown",
        owner: "external",
        guidance_url: OPENCODE_GUIDANCE_URL,
      },
    ],
  };
  renderProfileRuntimeInfo({
    agentName: "opencode-acp",
    discoveryState: "ready",
    runtimeInfo: prefixedNativeRuntime,
  });

  expect(screen.getByRole("link", { name: "Manual update guidance" }).getAttribute("href")).toBe(
    OPENCODE_GUIDANCE_URL,
  );
  expect(screen.queryByRole("link", { name: MANAGE_BRIDGE_VERSION_LABEL })).toBeNull();
  expect(screen.queryByTestId(RUNTIME_STATUS_TEST_ID)).toBeNull();
});

it("keeps the trusted managed fallback action for an unknown prefixed launch", () => {
  const prefixedRuntime: RuntimeInfo = {
    scope: "host",
    observed_at: runtimeInfo.observed_at,
    components: [
      {
        role: "bridge",
        name: "Codex",
        source: "unknown",
        owner: "kandev",
        package: "@agentclientprotocol/codex-acp",
        effective_version: "1.1.0",
      },
    ],
  };
  renderProfileRuntimeInfo(
    {
      agentName: "codex-acp",
      discoveryState: "ready",
      runtimeInfo: prefixedRuntime,
    },
    {
      "codex-acp": {
        agent_name: "codex-acp",
        display_name: "Codex",
        runtime_id: "managed:codex-acp",
        owner: "kandev",
        mechanism: "npm",
        management: "managed",
        available: true,
        enabled: true,
        auto_update_supported: false,
        auto_update: false,
        package: "@agentclientprotocol/codex-acp",
        default_version: "1.2.0",
        effective_version: "1.1.0",
        check_state: "update_available",
      },
    } satisfies Record<string, AgentUpdateStatus>,
  );

  expect(screen.getByText("Configured: 1.1.0")).toBeTruthy();
  expect(screen.getByRole("link", { name: MANAGE_BRIDGE_VERSION_LABEL }).getAttribute("href")).toBe(
    "/settings/agents#installed-agent-codex-acp",
  );
  expect(screen.queryByTestId(RUNTIME_STATUS_TEST_ID)).toBeNull();
});

it("refreshes shared release status when the subscribed agent update finishes", async () => {
  listStatusesMock.mockResolvedValueOnce({
    statuses: [
      {
        agent_name: CLAUDE_AGENT,
        package: CLAUDE_PACKAGE,
        default_version: "1.2.0",
        effective_version: "1.1.0",
        latest_version: "1.2.0",
        check_state: "up_to_date",
      },
    ],
  });
  const initialStatuses = {
    [CLAUDE_AGENT]: {
      agent_name: CLAUDE_AGENT,
      display_name: "Claude",
      runtime_id: `managed:${CLAUDE_AGENT}`,
      owner: "kandev",
      mechanism: "npm",
      management: "managed",
      available: true,
      enabled: true,
      auto_update_supported: false,
      auto_update: false,
      package: CLAUDE_PACKAGE,
      default_version: "1.2.0",
      effective_version: "1.1.0",
      check_state: "update_available",
    },
  } satisfies Record<string, AgentUpdateStatus>;

  render(
    <StateProvider>
      <SeedRuntimeStatuses statuses={initialStatuses}>
        <ProfileRuntimeInfo
          agentName={CLAUDE_AGENT}
          discoveryState="ready"
          runtimeInfo={runtimeInfo}
        />
        <FinishAgentUpdate agentName={CLAUDE_AGENT} />
      </SeedRuntimeStatuses>
    </StateProvider>,
  );

  expect(screen.getByTestId(RUNTIME_STATUS_TEST_ID).textContent).toBe(
    "A managed runtime update is available.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Finish update" }));

  await waitFor(() =>
    expect(screen.getByTestId(RUNTIME_STATUS_TEST_ID).textContent).toBe(
      "The managed runtime is up to date.",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Finish update" }));
  expect(listStatusesMock).toHaveBeenCalledTimes(1);
  expect(listStatusesMock).toHaveBeenCalledWith({ cache: "no-store" });
});

it("refreshes after a failed update without clearing the available update status", async () => {
  const statuses = {
    [CLAUDE_AGENT]: {
      agent_name: CLAUDE_AGENT,
      display_name: "Claude",
      runtime_id: `managed:${CLAUDE_AGENT}`,
      owner: "kandev",
      mechanism: "npm",
      management: "managed",
      available: true,
      enabled: true,
      auto_update_supported: false,
      auto_update: false,
      package: CLAUDE_PACKAGE,
      default_version: "1.2.0",
      effective_version: "1.1.0",
      check_state: "update_available",
    },
  } satisfies Record<string, AgentUpdateStatus>;
  listStatusesMock.mockResolvedValueOnce({ statuses: Object.values(statuses) });

  render(
    <StateProvider>
      <SeedRuntimeStatuses statuses={statuses}>
        <ProfileRuntimeInfo
          agentName={CLAUDE_AGENT}
          discoveryState="ready"
          runtimeInfo={runtimeInfo}
        />
        <FinishAgentUpdate agentName={CLAUDE_AGENT} status="failed" />
      </SeedRuntimeStatuses>
    </StateProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Finish update" }));

  await waitFor(() => expect(listStatusesMock).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId(RUNTIME_STATUS_TEST_ID).textContent).toBe(
    "A managed runtime update is available.",
  );
});

it("shows an explicit unknown state when a profile probe is unavailable", () => {
  renderProfileRuntimeInfo({ agentName: "mock-agent", discoveryState: "failed" });

  expect(screen.getByText("Runtime details are unavailable for this profile.")).toBeTruthy();
  expect(
    screen.getByText(
      "The available models come from this profile. This list does not confirm account access to every model.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

it("labels the retained runtime observation as stale while keeping recovery available", () => {
  renderProfileRuntimeInfo({
    agentName: CLAUDE_AGENT,
    discoveryState: "stale",
    runtimeInfo,
  });

  expect(screen.getByText("Refresh profile discovery to inspect runtime details.")).toBeTruthy();
  expect(screen.getByText("Observed: 1.11.0")).toBeTruthy();
  expect(screen.getByRole("link", { name: MANAGE_BRIDGE_VERSION_LABEL })).toBeTruthy();
});

it("does not render untrusted guidance URLs", () => {
  const untrusted: RuntimeInfo = {
    ...runtimeInfo,
    components: [
      {
        role: "provider",
        name: "Runtime",
        source: "unknown",
        owner: "unknown",
        guidance_url: "javascript:alert(1)",
      },
    ],
  };

  renderProfileRuntimeInfo({
    agentName: "mock-agent",
    discoveryState: "ready",
    runtimeInfo: untrusted,
  });

  expect(screen.getByText("Version unknown")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Provider guidance" })).toBeNull();
});
