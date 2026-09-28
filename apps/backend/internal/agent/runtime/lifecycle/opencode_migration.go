package lifecycle

import (
	"context"
	"errors"

	"github.com/kandev/kandev/internal/agent/agents"
)

var (
	ErrOpenCodeMigrationUnavailable = errors.New("OpenCode migration admission is unavailable")
	ErrOpenCodeExecutionActive      = errors.New("OpenCode executions are active")
)

// AcquireOpenCodeMigration reserves the launch-admission boundary used for the
// authoritative runtime-selection write. It refuses active host work and any
// remaining tracked OpenCode execution, including executions on remote hosts.
func (m *Manager) AcquireOpenCodeMigration(ctx context.Context) (context.Context, func(), error) {
	m.activityMu.Lock()
	coordinator := m.activityCoordinator
	m.activityMu.Unlock()
	if coordinator == nil {
		return nil, nil, ErrOpenCodeMigrationUnavailable
	}
	lease, _, err := coordinator.TryAcquireExclusiveMaintenance(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, execution := range m.executionStore.List() {
		if execution.AgentID == agents.OpenCodeACPAgentID {
			lease.Release()
			return nil, nil, ErrOpenCodeExecutionActive
		}
	}
	return lease.Context(), lease.Release, nil
}
