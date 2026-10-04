package hostutility

import (
	"testing"

	"github.com/kandev/kandev/internal/agent/agents"
)

func TestBuildProbeRequestCarriesTrustedRuntimeDescriptors(t *testing.T) {
	tests := []struct {
		name            string
		agent           agents.InferenceAgent
		wantBridge      string
		wantProvider    string
		wantProviderPkg string
	}{
		{
			name: "Codex ACP", agent: agents.NewCodexACP(), wantBridge: "@agentclientprotocol/codex-acp",
			wantProvider: "Codex CLI", wantProviderPkg: "@openai/codex",
		},
		{
			name: "Claude ACP", agent: agents.NewClaudeACP(), wantBridge: "@agentclientprotocol/claude-agent-acp",
			wantProvider: "Claude Agent SDK", wantProviderPkg: "@anthropic-ai/claude-agent-sdk",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := buildProbeRequest(&instance{agentType: tt.agent.(agents.Agent).ID()}, tt.agent, true, agents.Command{})
			descriptor := request.RuntimeObservation
			if descriptor == nil || descriptor.Bridge.Package != tt.wantBridge || descriptor.Bridge.Source != agents.RuntimeComponentManaged {
				t.Fatalf("bridge descriptor = %#v", descriptor)
			}
			if descriptor.Provider == nil || descriptor.Provider.Name != tt.wantProvider || descriptor.Provider.Package != tt.wantProviderPkg {
				t.Fatalf("provider descriptor = %#v", descriptor.Provider)
			}
			caps := AgentCapabilities{RuntimeInfo: &agents.RuntimeInfo{
				Components: []agents.RuntimeComponent{{
					Role: agents.RuntimeComponentBridge, Package: tt.wantBridge,
				}},
			}}
			stampConfiguredRuntimeVersion(
				&caps,
				tt.agent,
				tt.agent.(agents.ManagedNPMRuntimeAgent).ManagedNPMRuntime().ACPCommand("1.2.3"),
			)
			if got := caps.RuntimeInfo.Components[0].EffectiveVersion; got != "1.2.3" {
				t.Fatalf("effective version = %q, want version from captured managed command", got)
			}
		})
	}
}

func TestBuildProbeRequestAttributesOpenCodeFromResolvedCommand(t *testing.T) {
	agent := agents.NewOpenCodeACP()
	spec := agent.ManagedNPMRuntime()
	inst := &instance{agentType: agent.ID()}

	native := buildProbeRequest(inst, agent, true, spec.NativeCommand()).RuntimeObservation.Bridge
	if native.Source != agents.RuntimeComponentExternal || native.Owner != agents.RuntimeComponentOwnerExternal {
		t.Fatalf("native OpenCode descriptor = %#v, want external ownership", native)
	}
	if native.Package != "" || native.GuidanceURL != "https://opencode.ai/docs/cli/" {
		t.Fatalf("native OpenCode descriptor = %#v, want no managed package and trusted manual guidance", native)
	}

	managed := buildProbeRequest(inst, agent, true, spec.ACPCommand("1.2.3")).RuntimeObservation.Bridge
	if managed.Source != agents.RuntimeComponentManaged || managed.Owner != agents.RuntimeComponentOwnerKandev || managed.Package != spec.Package {
		t.Fatalf("managed OpenCode fallback descriptor = %#v", managed)
	}

	custom := buildProbeRequest(inst, agent, true, agents.NewCommand("custom-opencode-wrapper", "opencode", "acp")).RuntimeObservation.Bridge
	if custom.Source != agents.RuntimeComponentUnknown || custom.Owner != agents.RuntimeComponentOwnerUnknown {
		t.Fatalf("custom OpenCode command was attributed: %#v", custom)
	}
}
