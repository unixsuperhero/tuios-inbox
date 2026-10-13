package inbox

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestHostsAndExplicitWindowMachine(t *testing.T) {
	var launch map[string]string
	launches := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/hosts":
			fmt.Fprint(w, `{"hosts":[{"host":"local","status":"up","hostname":"laptop"},{"host":"builder","status":"up","hostname":"build.example"},{"host":"offline","status":"unreachable"},{"host":"archive","status":"up","read_only":true}]}`)
		case "POST /api/tasks/task-1/panes":
			launches++
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
	client := New(server.URL)
	hosts, err := client.Hosts()
	if err != nil {
		t.Fatal(err)
	}
	want := []Host{{Host: "local", Status: "up", Hostname: "laptop"}, {Host: "builder", Status: "up", Hostname: "build.example"}, {Host: "offline", Status: "unreachable"}, {Host: "archive", Status: "up", ReadOnly: true}}
	if !reflect.DeepEqual(hosts, want) {
		t.Fatalf("hosts = %#v, want %#v", hosts, want)
	}
	for i, available := range []bool{true, true, false, false} {
		if hosts[i].Available() != available {
			t.Errorf("availability of %s = %v, want %v", hosts[i].Host, hosts[i].Available(), available)
		}
	}
	if err := client.CreateWindow("task-1", "compile", "builder"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(launch, map[string]string{"name": "compile", "kind": "shell", "host": "builder"}) {
		t.Fatalf("launch payload = %#v", launch)
	}
	if err := client.CreateWindow("task-1", "compile", "   "); err == nil || !strings.Contains(err.Error(), "choose an execution machine") {
		t.Fatalf("empty host error = %v", err)
	}
	if launches != 1 {
		t.Fatalf("empty host sent an extra launch: %d requests", launches)
	}
}

func TestUnavailableHosts(t *testing.T) {
	for _, status := range []string{"down", "saved", "unknown", "unreachable", "read-only", "readonly"} {
		if (Host{Host: "builder", Status: status}).Available() {
			t.Errorf("%s host must not be selectable", status)
		}
	}
	if (Host{Status: "up"}).Available() {
		t.Error("missing host alias must not be selectable")
	}
	if !(Host{Host: "builder", Status: "up"}).Available() {
		t.Error("online builder must be selectable")
	}
}

func TestCreateSessionAssignsStarterWindowsAndReportsPartialFailure(t *testing.T) {
	for _, failure := range []string{"", "inventory", "assign", "bind"} {
		t.Run(failure, func(t *testing.T) {
			assigned := map[string]string{}
			bound := ""
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" && r.URL.Path == "/api/tuios" {
					if failure == "inventory" {
						http.Error(w, "inventory unavailable", http.StatusServiceUnavailable)
						return
					}
					fmt.Fprint(w, `{"windows":[{"window_id":"starter-1"},{"window_id":"starter-2"}]}`)
					return
				}
				var body map[string]string
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				switch body["action"] {
				case "create-session":
					fmt.Fprint(w, `{"session":"work"}`)
				case "assign-task":
					if failure == "assign" {
						http.Error(w, "assignment refused", http.StatusConflict)
						return
					}
					assigned[body["window"]] = body["taskId"]
					fmt.Fprint(w, "{}")
				case "bind-task":
					if failure == "bind" {
						http.Error(w, "task unavailable", http.StatusConflict)
						return
					}
					bound = body["session"]
					fmt.Fprint(w, "{}")
				default:
					t.Errorf("unexpected action: %s", body["action"])
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			err := New(server.URL).CreateSession("task-1", "work")
			if failure != "" {
				step := map[string]string{"inventory": "reading starter windows", "assign": "assigning window", "bind": "setting the task home"}[failure]
				if err == nil || !strings.Contains(err.Error(), "session \"work\" created; "+step+" failed") {
					t.Fatalf("partial creation error = %v", err)
				}
				if bound != "" {
					t.Fatalf("failed operation bound task to %q", bound)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if bound != "work" || !reflect.DeepEqual(assigned, map[string]string{"starter-1": "task-1", "starter-2": "task-1"}) {
				t.Fatalf("home = %q, assignments = %#v", bound, assigned)
			}
		})
	}
}
