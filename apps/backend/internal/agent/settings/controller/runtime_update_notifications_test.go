package controller

import (
	"context"
	"github.com/kandev/kandev/internal/agent/agents"
	"github.com/kandev/kandev/internal/agent/hostutility"
	"github.com/kandev/kandev/internal/agent/managedruntime"
	"github.com/kandev/kandev/internal/agent/settings/dto"
	"sync"
	"testing"
)

type runtimeNoticeCapture struct {
	mu      sync.Mutex
	notices []agents.RuntimeUpdateNotice
	batches [][]agents.RuntimeUpdateNotice
}

func (n *runtimeNoticeCapture) HandleAgentRuntimeUpdate(_ context.Context, notice agents.RuntimeUpdateNotice) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.notices = append(n.notices, notice)
}

func (n *runtimeNoticeCapture) HandleAgentRuntimeUpdates(_ context.Context, notices []agents.RuntimeUpdateNotice) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.batches = append(n.batches, append([]agents.RuntimeUpdateNotice(nil), notices...))
	n.notices = append(n.notices, notices...)
}

// @covers AC-AGENTS-RUNTIME-NOTIFY-001.3, AC-AGENTS-RUNTIME-NOTIFY-002.6
func TestRuntimeBackgroundPassNamesManualRuntimeAndRetainedOutcome(t *testing.T) {
	ag := agents.NewKimiACP()
	c := newTestController(map[string]agents.Agent{ag.ID(): ag})
	c.SetRuntimeUpdater(&recoveryRuntimeUpdater{currentFound: true, current: hostutility.AgentCapabilities{Status: hostutility.StatusOK, AgentVersion: "1.0.0"}})
	c.SetRuntimeUpdateStatusResolver(func(context.Context, string) (string, error) { return "2.0.0", nil })
	n := &runtimeNoticeCapture{}
	c.SetRuntimeUpdateNotifier(n)
	if err := c.RunRuntimeUpdatePass(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(n.notices) != 0 {
		t.Fatalf("availability bypassed its collection window: %+v", n.notices)
	}
	c.publishRuntimeStatus(context.Background(), dto.AgentUpdateStatusDTO{AgentName: "gemini", DisplayName: "Gemini", RuntimeID: "npm:@google/gemini-cli", Available: true, Enabled: true, CheckState: dto.AgentUpdateCheckStateUnknown, LastOutcome: &managedruntime.UpdateOutcome{ID: "attempt", Status: "failed", PreviousVersion: "1.0.0", TargetVersion: "2.0.0"}})
	if len(n.notices) != 1 || n.notices[0].Status != "failed" || n.notices[0].PreviousVersion != "1.0.0" {
		t.Fatalf("retained failure: %+v", n.notices)
	}
}

func (n *runtimeNoticeCapture) count() int { n.mu.Lock(); defer n.mu.Unlock(); return len(n.notices) }

func (n *runtimeNoticeCapture) batchCount() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.batches)
}
