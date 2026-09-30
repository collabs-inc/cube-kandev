package sqlite

import (
	"fmt"
	"testing"
	"time"

	"github.com/kandev/kandev/internal/task/models"
	v1 "github.com/kandev/kandev/pkg/api/v1"
	"github.com/stretchr/testify/require"
)

func TestSidebarTreeActivityAndStateShareCompleteAncestors(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			repo := newRepoForSidebarConformance(t, backend)
			ctx := t.Context()
			seedWorkspace(t, repo, "ancestors")
			base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
			for _, row := range []struct {
				id, parent, state, primary string
				activity                   time.Duration
			}{
				{"root", "", "TODO", "", 0},
				{"middle", "root", "TODO", "", time.Minute},
				{"leaf", "middle", "COMPLETED", "RUNNING", 10 * time.Minute},
				{"peer", "", "IN_PROGRESS", "", 5 * time.Minute},
			} {
				require.NoError(t, repo.CreateTask(ctx, &models.Task{
					ID: row.id, WorkspaceID: "ancestors", Title: row.id, ParentID: row.parent,
					State: v1.TaskState(row.state), CreatedAt: base, UpdatedAt: base,
				}))
				summary := fmt.Sprintf(`{"last_activity_at":%q,"primary_session":{"state":%q}}`,
					base.Add(row.activity).Format(time.RFC3339Nano), row.primary)
				_, err := repo.db.ExecContext(ctx, repo.db.Rebind(`INSERT INTO task_status_summaries
					(task_id, workspace_id, revision, summary, updated_at) VALUES (?, ?, 1, ?, ?)`),
					row.id, "ancestors", summary, base)
				require.NoError(t, err)
			}
			query := sidebarTaskQuery(1)
			query.Group = "state"
			query.Sort = models.SidebarTaskViewSort{Key: "lastActivityAt", Direction: "desc"}
			query.PageSize = 2
			first, err := repo.QuerySidebarTaskPage(ctx, "ancestors", query, models.SidebarTaskViewPreferences{})
			require.NoError(t, err)
			require.Equal(t, []string{"root", "middle"}, sidebarTaskIDs(first.Tasks))
			require.Equal(t, "IN_PROGRESS", first.Entries[0].GroupKey)
			for _, entry := range first.Entries {
				if entry.TaskID == "root" {
					require.Equal(t, 2, entry.SubtaskCount)
				}
			}
			query.Page = 2
			second, err := repo.QuerySidebarTaskPage(ctx, "ancestors", query, models.SidebarTaskViewPreferences{})
			require.NoError(t, err)
			require.Equal(t, []string{"leaf", "peer"}, sidebarTaskIDs(second.Tasks))
			require.Equal(t, 4, second.TotalVisibleTasks)
		})
	}
}
