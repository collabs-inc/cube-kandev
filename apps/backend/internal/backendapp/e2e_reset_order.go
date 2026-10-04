package backendapp

import (
	"errors"

	taskmodels "github.com/kandev/kandev/internal/task/models"
)

// Children must be removed before their parents through the guarded task service.
func tasksForE2EResetDeletion(tasks []*taskmodels.Task) ([]*taskmodels.Task, error) {
	children := make(map[string][]*taskmodels.Task)
	for _, task := range tasks {
		children[task.ParentID] = append(children[task.ParentID], task)
	}
	ordered := make([]*taskmodels.Task, 0, len(tasks))
	visiting := make(map[string]bool)
	visited := make(map[string]bool)
	var visit func(*taskmodels.Task) error
	visit = func(task *taskmodels.Task) error {
		if visiting[task.ID] {
			return errors.New("task hierarchy contains a cycle")
		}
		if visited[task.ID] {
			return nil
		}
		visiting[task.ID] = true
		for _, child := range children[task.ID] {
			if err := visit(child); err != nil {
				return err
			}
		}
		delete(visiting, task.ID)
		visited[task.ID] = true
		ordered = append(ordered, task)
		return nil
	}
	for _, task := range tasks {
		if err := visit(task); err != nil {
			return nil, err
		}
	}
	return ordered, nil
}
