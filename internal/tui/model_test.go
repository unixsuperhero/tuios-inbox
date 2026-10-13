package tui

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"

	"tuios-inbox/internal/inbox"
)

func TestCreateWindowChoosesNativeMachine(t *testing.T) {
	var launch map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/hosts":
			fmt.Fprint(w, `{"hosts":[{"host":"local","status":"up"},{"host":"offline","status":"unreachable"},{"host":"builder","hostname":"build.example","status":"up"},{"host":"archive","status":"up","read_only":true}]}`)
		case "POST /api/tasks/task-1/panes":
			if err := json.NewDecoder(r.Body).Decode(&launch); err != nil {
				t.Error(err)
			}
			fmt.Fprint(w, `{}`)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	m := New(Config{Client: inbox.New(server.URL)})
	m.Snapshot.Tasks = []inbox.Task{{ID: "task-1", Title: "Build", Session: "global-work"}}
	m.TaskID = "task-1"
	m.w, m.h = 90, 24
	m.handleKey("w", "")
	m.handleKey("", "compile")
	if cmd := m.handleKey("enter", ""); cmd != nil || !strings.Contains(m.Error, "Choose an available execution machine") {
		t.Fatalf("missing-machine submission: cmd=%v error=%q", cmd != nil, m.Error)
	}
	cmd := m.handleKey("ctrl+o", "")
	if cmd == nil {
		t.Fatal("machine picker did not fetch native inventory")
	}
	m.Update(cmd())
	m.handleKey("down", "")
	m.handleKey("enter", "")
	if m.Form != formChooseHost || !strings.Contains(m.Error, "unavailable") {
		t.Fatalf("offline selection: form=%v error=%q", m.Form, m.Error)
	}
	m.handleKey("", "build.example")
	m.handleKey("enter", "")
	if m.Form != formNewWindow || m.Host != "builder" || m.Draft.Text != "compile" || m.TaskID != "task-1" {
		t.Fatalf("selected machine lost form state: form=%v host=%q name=%q task=%q", m.Form, m.Host, m.Draft.Text, m.TaskID)
	}
	for _, width := range []int{42, 90} {
		m.w = width
		lines, hits := m.layout(0)
		if !strings.Contains(strings.Join(lines, "\n"), "Machine: builder") {
			t.Fatalf("machine field missing at width %d", width)
		}
		found := false
		for _, hit := range hits {
			found = found || hit.id == hitChooseHost
		}
		if !found {
			t.Fatalf("machine chooser is not clickable at width %d", width)
		}
	}
	for _, key := range []string{"tab", "ctrl+n"} {
		m.handleKey(key, "")
		m.handleKey("esc", "")
		if m.Form != formNewWindow || m.Host != "builder" || m.Draft.Text != "compile" || m.TaskID != "task-1" {
			t.Fatalf("%s cancellation lost selected machine/form state", key)
		}
	}
	cmd = m.handleKey("enter", "")
	if cmd == nil {
		t.Fatalf("selected-machine submission failed: %s", m.Error)
	}
	msg := cmd().(loadMsg)
	if msg.Err != nil {
		t.Fatal(msg.Err)
	}
	if !reflect.DeepEqual(launch, map[string]string{"name": "compile", "kind": "shell", "host": "builder"}) {
		t.Fatalf("window launch payload = %#v", launch)
	}
}

func TestMachinePickerCancelAndStaleInventory(t *testing.T) {
	m := New(Config{})
	m.w, m.h = 42, 10
	m.Form = formNewWindow
	m.TaskID = "task-1"
	m.Draft.insert("compile")
	m.Host = "builder"
	m.Hosts = []inbox.Host{{Host: "builder", Status: "up"}}
	m.Filter.insert("previous filter")
	m.chooseHost()
	gen := m.Gen
	m.handleKey("esc", "")
	m.Update(hostsMsg{Gen: gen, Hosts: []inbox.Host{{Host: "obsolete", Status: "up"}}})
	if m.Form != formNewWindow || m.Host != "builder" || m.Draft.Text != "compile" || m.Filter.Text != "previous filter" || m.Busy {
		t.Fatalf("cancel did not restore name, machine, filter, and readiness: %#v", m)
	}
	if !reflect.DeepEqual(m.Hosts, []inbox.Host{{Host: "builder", Status: "up"}}) {
		t.Fatalf("stale inventory replaced current machines: %#v", m.Hosts)
	}
}

func TestMachinePickerMouseAndUnavailableRows(t *testing.T) {
	m := New(Config{})
	m.w, m.h = 42, 10
	m.Form = formNewWindow
	m.Draft.insert("compile")
	m.openFromForm(formChooseHost)
	m.Hosts = []inbox.Host{{Host: "archive", Status: "up", ReadOnly: true}, {Host: "builder", Status: "up"}}
	m.Update(tea.WindowSizeMsg{Width: 42, Height: 10})
	lines, hits := m.layout(m.rowCount())
	if !strings.Contains(strings.Join(lines, "\n"), "unavailable (read-only)") {
		t.Fatal("read-only machine availability is not shown")
	}
	for _, hit := range hits {
		if hit.id == 0 {
			t.Fatal("read-only machine should not be clickable")
		}
		if hit.id == 1 {
			m.handleClick(hit.x0, hit.y)
			if m.Form != formNewWindow || m.Host != "builder" || m.Draft.Text != "compile" {
				t.Fatal("mouse machine selection lost form state")
			}
			return
		}
	}
	t.Fatal("available machine was not clickable")
}

func TestInlineTaskCreationPreservesWindowMachine(t *testing.T) {
	m := New(Config{})
	m.Form = formNewWindow
	m.TaskID = "task-1"
	m.Snapshot.Tasks = []inbox.Task{{ID: "task-1", Title: "Build"}}
	m.Draft.insert("compile")
	m.Host = "builder"
	m.Hosts = []inbox.Host{{Host: "builder", Status: "up"}}
	m.handleKey("ctrl+n", "")
	created := inbox.Task{ID: "task-2", Title: "Release"}
	m.handleLoad(loadMsg{Gen: m.Gen, Created: &created})
	if m.Form != formNewWindow || m.TaskID != "task-2" || m.Draft.Text != "compile" || m.Host != "builder" {
		t.Fatalf("inline task creation lost window form: form=%v task=%q draft=%q host=%q", m.Form, m.TaskID, m.Draft.Text, m.Host)
	}
}
