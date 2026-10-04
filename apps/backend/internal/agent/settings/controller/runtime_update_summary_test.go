package controller

import (
	"context"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/kandev/kandev/internal/agent/agents"
	"github.com/kandev/kandev/internal/agent/managedruntime"
	"github.com/kandev/kandev/internal/agent/settings/dto"
)

type runtimeSummaryCapture struct {
	mu           sync.Mutex
	individual   []agents.RuntimeUpdateNotice
	batches      [][]agents.RuntimeUpdateNotice
	batchStart   chan struct{}
	releaseBatch <-chan struct{}
}

func (n *runtimeSummaryCapture) HandleAgentRuntimeUpdate(_ context.Context, notice agents.RuntimeUpdateNotice) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.individual = append(n.individual, notice)
}

func (n *runtimeSummaryCapture) HandleAgentRuntimeUpdates(ctx context.Context, notices []agents.RuntimeUpdateNotice) {
	n.mu.Lock()
	n.batches = append(n.batches, append([]agents.RuntimeUpdateNotice(nil), notices...))
	n.mu.Unlock()
	if n.batchStart != nil {
		n.batchStart <- struct{}{}
		select {
		case <-n.releaseBatch:
		case <-ctx.Done():
		}
	}
}

func (n *runtimeSummaryCapture) snapshot() ([]agents.RuntimeUpdateNotice, [][]agents.RuntimeUpdateNotice) {
	n.mu.Lock()
	defer n.mu.Unlock()
	individual := append([]agents.RuntimeUpdateNotice(nil), n.individual...)
	batches := append([][]agents.RuntimeUpdateNotice(nil), n.batches...)
	return individual, batches
}

// @covers AC-AGENTS-RUNTIME-NOTIFY-003.7
func TestRuntimeUpdateOutcomeDispatchDoesNotWaitForSummaryDelivery(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gemini := agents.NewGemini()
		c := newTestController(map[string]agents.Agent{gemini.ID(): gemini})
		c.SetRuntimeUpdateStatusResolver(func(context.Context, string) (string, error) { return "9.0.0", nil })
		batchStart := make(chan struct{}, 1)
		releaseBatch := make(chan struct{})
		notices := &runtimeSummaryCapture{batchStart: batchStart, releaseBatch: releaseBatch}
		c.SetRuntimeUpdateNotifier(notices)
		stop := c.StartRuntimeUpdateBackground(context.Background())
		defer stop()
		synctest.Wait()

		time.Sleep(runtimeUpdateAvailabilityWindow)
		synctest.Wait()
		select {
		case <-batchStart:
		default:
			t.Fatal("summary notifier did not reach its delivery barrier")
		}

		published := make(chan struct{})
		go func() {
			c.publishRuntimeStatus(context.Background(), dto.AgentUpdateStatusDTO{
				AgentName: gemini.ID(), DisplayName: "Gemini", RuntimeID: agents.RuntimeUpdateCapabilities(gemini).RuntimeID,
				Available: true, Enabled: true, CheckState: dto.AgentUpdateCheckStateUpdateAvailable,
				EffectiveVersion: "1.0.0", LatestVersion: "9.0.0",
				LastOutcome: &managedruntime.UpdateOutcome{ID: "attempt", Status: "failed", PreviousVersion: "1.0.0", TargetVersion: "9.0.0"},
			})
			close(published)
		}()
		synctest.Wait()
		select {
		case <-published:
		default:
			t.Fatal("runtime status publication waited for summary delivery")
		}
		individual, _ := notices.snapshot()
		if len(individual) != 1 || individual[0].Status != managedruntime.UpdateOutcomeFailed {
			t.Fatalf("terminal outcome was not delivered while summary was blocked: %+v", individual)
		}

		close(releaseBatch)
		time.Sleep(runtimeUpdateAvailabilityWindow)
		synctest.Wait()
		_, batches := notices.snapshot()
		if len(batches) != 2 || len(batches[1]) != 1 || batches[1][0].Status != "available" {
			t.Fatalf("terminal outcome replaced its availability observation: %+v", batches)
		}
	})
}

// @covers AC-AGENTS-RUNTIME-NOTIFY-003.6
func TestRuntimeUpdateSummaryUsesRevalidatedEffectiveVersion(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gemini := agents.NewGemini()
		packageName := gemini.ManagedNPMRuntime().Package
		selectionKey := gemini.ID() + "\x00" + packageName
		selections := &statusSelectionStore{selection: map[string]managedruntime.Selection{
			selectionKey: {Package: packageName, Version: "1.0.0"},
		}}
		c := newTestController(map[string]agents.Agent{gemini.ID(): gemini})
		c.SetManagedRuntimeSelectionStore(selections)
		c.SetRuntimeUpdateStatusResolver(func(context.Context, string) (string, error) { return "3.0.0", nil })
		notices := &runtimeSummaryCapture{}
		c.SetRuntimeUpdateNotifier(notices)
		stop := c.StartRuntimeUpdateBackground(context.Background())
		defer stop()
		synctest.Wait()

		selections.set(selectionKey, managedruntime.Selection{Package: packageName, Version: "2.0.0"})
		time.Sleep(runtimeUpdateAvailabilityWindow)
		synctest.Wait()
		_, batches := notices.snapshot()
		if len(batches) != 1 || len(batches[0]) != 1 {
			t.Fatalf("runtime availability was not delivered once: %+v", batches)
		}
		wantOccurrence := runtimeNoticeKey(gemini.ID(), agents.RuntimeUpdateCapabilities(gemini).RuntimeID, "3.0.0", "available")
		got := batches[0][0]
		if got.PreviousVersion != "2.0.0" || got.Version != "3.0.0" || got.OccurrenceID != wantOccurrence || got.DisplayName != "Gemini" {
			t.Fatalf("summary member used stale availability metadata: got %+v", got)
		}
	})
}

// @covers AC-AGENTS-RUNTIME-NOTIFY-003.1, AC-AGENTS-RUNTIME-NOTIFY-003.2
func TestRuntimeUpdateSummaryWaitsForFixedWindowAndBatchesStartupNotices(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gemini := agents.NewGemini()
		claude := agents.NewClaudeACP()
		c := newTestController(map[string]agents.Agent{gemini.ID(): gemini, claude.ID(): claude})
		c.SetRuntimeUpdateStatusResolver(func(context.Context, string) (string, error) { return "9.0.0", nil })
		notices := &runtimeSummaryCapture{}
		c.SetRuntimeUpdateNotifier(notices)
		stop := c.StartRuntimeUpdateBackground(context.Background())
		defer stop()
		synctest.Wait()

		individual, batches := notices.snapshot()
		if len(individual) != 0 || len(batches) != 0 {
			t.Fatalf("availability delivered during collection: individual=%d batches=%d", len(individual), len(batches))
		}
		if err := c.ReplayRuntimeUpdateNotices(context.Background()); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()

		time.Sleep(20 * time.Second)
		response, err := c.ListAgentUpdateStatuses(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, status := range response.Statuses {
			if status.AgentName == gemini.ID() {
				c.publishRuntimeStatus(context.Background(), status)
				break
			}
		}
		synctest.Wait()
		time.Sleep(10 * time.Second)
		synctest.Wait()
		individual, batches = notices.snapshot()
		if len(individual) != 0 || len(batches) != 1 || len(batches[0]) != 2 {
			t.Fatalf("startup availability was not grouped once: individual=%+v batches=%+v", individual, batches)
		}
		if batches[0][0].AgentID != claude.ID() || batches[0][1].AgentID != gemini.ID() || batches[0][1].PreviousVersion == "" || batches[0][1].Version != "9.0.0" {
			t.Fatalf("summary members lost trusted runtime details: %+v", batches[0])
		}
	})
}

// @covers AC-AGENTS-RUNTIME-NOTIFY-003.6
func TestRuntimeUpdateSummaryDropsMembersNoLongerAvailable(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gemini := agents.NewGemini()
		c := newTestController(map[string]agents.Agent{gemini.ID(): gemini})
		latest := "9.0.0"
		c.SetRuntimeUpdateStatusResolver(func(context.Context, string) (string, error) { return latest, nil })
		notices := &runtimeSummaryCapture{}
		c.SetRuntimeUpdateNotifier(notices)
		stop := c.StartRuntimeUpdateBackground(context.Background())
		defer stop()
		synctest.Wait()

		response, err := c.ListAgentUpdateStatuses(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var effectiveVersion, packageName string
		for _, status := range response.Statuses {
			if status.AgentName == gemini.ID() {
				effectiveVersion, packageName = status.EffectiveVersion, status.Package
			}
		}
		if effectiveVersion == "" || packageName == "" {
			t.Fatal("runtime status did not provide revalidation identity")
		}
		latest = effectiveVersion
		c.InvalidateRuntimeUpdateStatus(packageName)
		time.Sleep(runtimeUpdateAvailabilityWindow)
		synctest.Wait()
		individual, batches := notices.snapshot()
		if len(individual) != 0 || len(batches) != 0 {
			t.Fatalf("obsolete availability was delivered: individual=%+v batches=%+v", individual, batches)
		}
	})
}

// @covers AC-AGENTS-RUNTIME-NOTIFY-003.7, AC-AGENTS-RUNTIME-NOTIFY-003.9
func TestRuntimeUpdateOutcomeBypassesWindowAndShutdownCancelsAvailability(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gemini := agents.NewGemini()
		c := newTestController(map[string]agents.Agent{gemini.ID(): gemini})
		c.SetRuntimeUpdateStatusResolver(func(context.Context, string) (string, error) { return "9.0.0", nil })
		notices := &runtimeSummaryCapture{}
		c.SetRuntimeUpdateNotifier(notices)
		stop := c.StartRuntimeUpdateBackground(context.Background())
		synctest.Wait()

		c.publishRuntimeStatus(context.Background(), dto.AgentUpdateStatusDTO{
			AgentName: gemini.ID(), DisplayName: "Gemini", RuntimeID: agents.RuntimeUpdateCapabilities(gemini).RuntimeID,
			Available: true, Enabled: true, CheckState: dto.AgentUpdateCheckStateUpdateAvailable,
			EffectiveVersion: "1.0.0", LatestVersion: "9.0.0",
			LastOutcome: &managedruntime.UpdateOutcome{ID: "attempt", Status: "interrupted", PreviousVersion: "1.0.0", TargetVersion: "9.0.0"},
		})
		synctest.Wait()
		individual, batches := notices.snapshot()
		if len(individual) != 1 || individual[0].Status != "interrupted" || len(batches) != 0 {
			t.Fatalf("terminal outcome waited for availability window: individual=%+v batches=%+v", individual, batches)
		}

		stop()
		time.Sleep(runtimeUpdateAvailabilityWindow)
		synctest.Wait()
		individual, batches = notices.snapshot()
		if len(individual) != 1 || len(batches) != 0 {
			t.Fatalf("shutdown delivered pending availability: individual=%+v batches=%+v", individual, batches)
		}
	})
}
