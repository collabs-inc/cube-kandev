"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@kandev/ui/button";
import Link from "@/components/routing/app-link";
import { useAppStore } from "@/components/state-provider";
import { useIsAdmin } from "@/hooks/domains/auth/use-is-admin";
import { useAgentRuntimeUpdateStatuses } from "@/hooks/domains/settings/use-agent-runtime-update-statuses";
import type { ProfileRuntimeComponent, ProfileRuntimeInfo as RuntimeInfo } from "@/lib/types/http";
import type { ProfileDiscoveryStatus } from "@/hooks/domains/settings/use-profile-model-capabilities";

type ProfileRuntimeInfoProps = {
  agentName: string;
  discoveryState: ProfileDiscoveryStatus;
  runtimeInfo?: RuntimeInfo;
};

const sourceKeys: Record<ProfileRuntimeComponent["source"], string> = {
  managed: "agents:profileRuntimeSourceManaged",
  bundled: "agents:profileRuntimeSourceBundled",
  external: "agents:profileRuntimeSourceExternal",
  unknown: "agents:profileRuntimeSourceUnknown",
};

const ownerKeys: Record<ProfileRuntimeComponent["owner"], string> = {
  kandev: "agents:runtimeManaged",
  external: "agents:runtimeManual",
  unknown: "agents:profileRuntimeOwnerUnknown",
};

const runtimeGuidanceKeys: Record<ProfileRuntimeComponent["role"], string> = {
  bridge: "agents:runtimeManualGuidance",
  provider: "agents:profileRuntimeProviderGuidance",
};

function safeHttpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function runtimeVersionCopy(
  component: ProfileRuntimeComponent,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const versions: string[] = [];
  if (component.observed_version) {
    versions.push(t("agents:runtimeObserved", { version: component.observed_version }));
  }
  if (component.effective_version) {
    versions.push(t("agents:profileRuntimeConfigured", { version: component.effective_version }));
  }
  return versions.length > 0 ? versions : [t("agents:profileRuntimeVersionUnknown")];
}

function RuntimeComponentRow({
  component,
  t,
}: {
  component: ProfileRuntimeComponent;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="min-w-0 space-y-1" data-testid={`profile-runtime-component-${component.role}`}>
      <div className="flex min-w-0 flex-col gap-1 md:flex-row md:flex-wrap md:items-baseline md:gap-x-3">
        <h4 className="text-sm font-medium">{component.name}</h4>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t(sourceKeys[component.source])}</span>
          <span>{t(ownerKeys[component.owner])}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-3">
        {runtimeVersionCopy(component, t).map((label) => (
          <span key={label}>{label}</span>
        ))}
        {component.package && (
          <code className="min-w-0 break-all font-mono">{component.package}</code>
        )}
      </div>
    </div>
  );
}

function runtimeEmptyStateKey(discoveryState: ProfileDiscoveryStatus): string {
  if (discoveryState === "loading") return "agents:profileRuntimeLoading";
  if (discoveryState === "failed") return "agents:profileRuntimeUnavailable";
  if (discoveryState === "stale") return "agents:profileRuntimeRefreshNeeded";
  return "agents:profileRuntimeUnknown";
}

function updateCheckKey(checkState?: string): string | undefined {
  if (checkState === "update_available") return "agents:profileRuntimeUpdateAvailable";
  if (checkState === "up_to_date") return "agents:profileRuntimeUpToDate";
  if (checkState === "unknown") return "agents:profileRuntimeReleaseUnknown";
  return undefined;
}

function ProfileRuntimeComponents({
  components,
  discoveryState,
  emptyStateKey,
  t,
}: {
  components: ProfileRuntimeComponent[];
  discoveryState: ProfileDiscoveryStatus;
  emptyStateKey: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (components.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t(emptyStateKey)}
      </p>
    );
  }
  return (
    <>
      {discoveryState !== "ready" && (
        <p className="text-sm text-muted-foreground" role="status">
          {t(emptyStateKey)}
        </p>
      )}
      <div className="space-y-3">
        {components.map((component) => (
          <RuntimeComponentRow
            key={`${component.role}:${component.name}`}
            component={component}
            t={t}
          />
        ))}
      </div>
    </>
  );
}

function ProfileRuntimeActions({
  agentName,
  components,
  t,
}: {
  agentName: string;
  components: ProfileRuntimeComponent[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const canManage = useIsAdmin();
  const bridge = components.find((component) => component.role === "bridge");
  const bridgeManaged = bridge?.source === "managed" && bridge.owner === "kandev";
  const bridgeHasManagedTarget =
    bridgeManaged ||
    (bridge?.source === "unknown" && bridge.owner === "kandev" && Boolean(bridge.package));
  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
      {canManage && bridgeHasManagedTarget && (
        <Button
          asChild
          variant="outline"
          className="h-7 w-full md:w-auto max-md:h-12 max-md:min-h-12 [@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:min-h-12"
        >
          <Link href={`/settings/agents#installed-agent-${encodeURIComponent(agentName)}`}>
            {t("agents:profileRuntimeManageBridge")}
          </Link>
        </Button>
      )}
      {components.map((component) => {
        const manualRuntime =
          component.role === "bridge" &&
          (component.source === "external" || component.source === "unknown") &&
          component.owner === "external";
        const guidanceUrl =
          component.role === "provider" || manualRuntime
            ? safeHttpsUrl(component.guidance_url)
            : undefined;
        if (!guidanceUrl) return null;
        const guidanceKey = runtimeGuidanceKeys[component.role];
        return (
          <Button
            key={`guidance:${component.name}`}
            asChild
            variant="outline"
            className="h-7 w-full md:w-auto max-md:h-12 max-md:min-h-12 [@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:min-h-12"
          >
            <a href={guidanceUrl} target="_blank" rel="noopener noreferrer">
              {t(guidanceKey)}
            </a>
          </Button>
        );
      })}
    </div>
  );
}

export function ProfileRuntimeInfo({
  agentName,
  discoveryState,
  runtimeInfo,
}: ProfileRuntimeInfoProps) {
  const { t } = useTranslation();
  const updateJob = useAppStore((state) => state.updateJobs.byAgent[agentName]);
  const updateJobs = useMemo(
    () => (updateJob ? { [agentName]: updateJob } : {}),
    [agentName, updateJob],
  );
  const { statusByAgent } = useAgentRuntimeUpdateStatuses(updateJobs);
  const updateStatus = statusByAgent[agentName];
  const components = runtimeInfo?.components ?? [];
  const bridgeManaged = components.some(
    (component) =>
      component.role === "bridge" && component.source === "managed" && component.owner === "kandev",
  );
  const updateStatusKey = bridgeManaged ? updateCheckKey(updateStatus?.check_state) : undefined;

  return (
    <section
      aria-label={t("agents:profileRuntimeTitle")}
      className="space-y-3 rounded-md border border-border/70 p-3"
      data-testid="profile-runtime-info"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("agents:profileRuntimeTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("agents:profileRuntimeHostScope")}</p>
      </div>

      <ProfileRuntimeComponents
        components={components}
        discoveryState={discoveryState}
        emptyStateKey={runtimeEmptyStateKey(discoveryState)}
        t={t}
      />

      {updateStatusKey && (
        <p className="text-xs text-muted-foreground" data-testid="profile-runtime-update-status">
          {t(updateStatusKey)}
        </p>
      )}

      <ProfileRuntimeActions agentName={agentName} components={components} t={t} />

      <p className="text-xs text-muted-foreground">{t("agents:profileRuntimeCatalogNote")}</p>
    </section>
  );
}
