//go:build linux

package utility

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.uber.org/zap"
)

func TestRuntimeObservationCommandTimeoutCleansDescendants(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "slow codex")
	pidFile := filepath.Join(dir, "child.pid")
	writeExecutable(t, binary, "#!/bin/sh\nsleep 30 &\necho $! > \""+pidFile+"\"\nwait\n")
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := runRuntimeObservationCommand(ctx, binary, []string{"--version"}, os.Environ(), dir, zap.NewNop())
	if err == nil {
		t.Fatal("timed out command returned success")
	}
	if time.Since(started) > time.Second {
		t.Fatalf("command cleanup exceeded the bound: %v", time.Since(started))
	}
	pid := readPID(t, pidFile)
	waitUntil(t, time.Second, func() bool { return !processRunning(pid) }, "observation child %d survived timeout", pid)
}
