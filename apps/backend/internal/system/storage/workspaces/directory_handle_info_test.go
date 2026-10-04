//go:build unix

package workspaces

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestPinnedDirectoryInfoReadsModeAndOwnerFromHandle(t *testing.T) {
	parent := t.TempDir()
	directory := filepath.Join(parent, "directory")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatalf("create directory: %v", err)
	}
	mode := os.FileMode(0o750) | os.ModeSetgid
	if err := os.Chmod(directory, mode); err != nil {
		t.Fatalf("set directory mode: %v", err)
	}
	handle, err := OpenDirectoryNoFollow(parent, directory)
	if err != nil {
		t.Fatalf("OpenDirectoryNoFollow: %v", err)
	}
	t.Cleanup(func() {
		if err := handle.Close(); err != nil {
			t.Errorf("close directory handle: %v", err)
		}
	})

	pinned, err := PinnedDirectoryInfo(handle)
	if err != nil {
		t.Fatalf("PinnedDirectoryInfo: %v", err)
	}
	pathInfo, err := os.Stat(directory)
	if err != nil {
		t.Fatalf("stat directory path: %v", err)
	}
	if pinned.Mode() != pathInfo.Mode() {
		t.Fatalf("pinned mode = %s, path mode = %s", pinned.Mode(), pathInfo.Mode())
	}
	pinnedOwner, pinnedOK := pinned.Sys().(*syscall.Stat_t)
	pathOwner, pathOK := pathInfo.Sys().(*syscall.Stat_t)
	if !pinnedOK || !pathOK || pinnedOwner.Uid != pathOwner.Uid || pinnedOwner.Gid != pathOwner.Gid {
		t.Fatalf("pinned owner = %#v, path owner = %#v", pinned.Sys(), pathInfo.Sys())
	}
}
