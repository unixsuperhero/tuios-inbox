// Package inbox is the HTTP client for tuios-inbox's task ownership and native-pane APIs.
package inbox

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Task is Inbox's task and its default execution home.
type Task struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Session   string `json:"session"`
	Workspace *int   `json:"workspace"`
	Archived  int    `json:"archived"`
}

// Agent records canonical task ownership for any shell or agent pane.
type Agent struct {
	ID      string `json:"id"`
	TaskID  string `json:"task_id"`
	Session string `json:"session"`
	Name    string `json:"name"`
}

// Snapshot contains only the task-management portion of Inbox state.
type Snapshot struct {
	Tasks  []Task  `json:"tasks"`
	Agents []Agent `json:"agents"`
}

// Window is a live native window, joined to its task assignment.
type Window struct {
	ID        string `json:"window_id"`
	Name      string `json:"display_name"`
	Title     string `json:"title"`
	Workspace int    `json:"workspace"`
	Session   string
}

// Client uses the existing Inbox HTTP API. Network work belongs off the UI goroutine.
type Client struct {
	base string
	http *http.Client
}

// New constructs a client for the configured Inbox URL.
func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) request(method, path string, body, result any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Inbox-Request", "1")
		req.Header.Set("Origin", c.base)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("Inbox unavailable at %s: %w", c.base, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&failure)
		if failure.Error == "" {
			failure.Error = response.Status
		}
		return fmt.Errorf("Inbox: %s", failure.Error)
	}
	if result == nil {
		_, err = io.Copy(io.Discard, response.Body)
		return err
	}
	return json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(result)
}

// State reads canonical tasks and pane assignments without retaining Inbox work records.
func (c *Client) State() (Snapshot, error) {
	var snapshot Snapshot
	err := c.request("GET", "/api/state", nil, &snapshot)
	return snapshot, err
}

// CreateTask creates a task with Inbox's normal default execution home.
func (c *Client) CreateTask(title string) (Task, error) {
	var task Task
	err := c.request("POST", "/api/tasks", map[string]string{"title": title}, &task)
	return task, err
}

// CreateWindow creates and assigns a shell in the task's default session and workspace.
func (c *Client) CreateWindow(taskID, name string) error {
	return c.request("POST", "/api/tasks/"+url.PathEscape(taskID)+"/panes", map[string]string{"name": name, "kind": "shell"}, nil)
}

// CreateSession creates a local session, assigns its starter panes, and makes it the task's default home.
// Errors after creation name the created session rather than claiming nothing happened.
func (c *Client) CreateSession(taskID, name string) error {
	var created struct {
		Session string `json:"session"`
	}
	if err := c.action(map[string]any{"action": "create-session", "name": name}, &created); err != nil {
		return err
	}
	var inventory struct {
		Windows []Window `json:"windows"`
	}
	if err := c.request("GET", "/api/tuios?session="+url.QueryEscape(created.Session), nil, &inventory); err != nil {
		return fmt.Errorf("session %q created; reading starter windows failed: %w", created.Session, err)
	}
	for _, window := range inventory.Windows {
		if err := c.action(map[string]any{"action": "assign-task", "taskId": taskID, "session": created.Session, "window": window.ID}, nil); err != nil {
			return fmt.Errorf("session %q created; assigning window failed: %w", created.Session, err)
		}
	}
	if err := c.action(map[string]any{"action": "bind-task", "taskId": taskID, "session": created.Session}, nil); err != nil {
		return fmt.Errorf("session %q created and windows assigned; setting the task home failed: %w", created.Session, err)
	}
	return nil
}

func (c *Client) action(body any, result any) error {
	return c.request("POST", "/api/tuios/action", body, result)
}

// Windows lists every live window assigned to a task, across its sessions and hosts.
// Native inventory excludes historical/closed panes; assignment comes from agents, not the stale creation record.
func (c *Client) Windows(snapshot Snapshot, taskID string) ([]Window, error) {
	owned := make(map[string]Agent)
	sessions := make(map[string]bool)
	for _, agent := range snapshot.Agents {
		if agent.TaskID == taskID {
			owned[agent.ID] = agent
			sessions[agent.Session] = true
		}
	}
	if len(owned) == 0 {
		return nil, nil
	}
	var inventory struct {
		Sessions []struct {
			Target string `json:"target"`
			Saved  bool   `json:"saved"`
		} `json:"sessions"`
	}
	if err := c.request("GET", "/api/tuios", nil, &inventory); err != nil {
		return nil, err
	}
	var windows []Window
	var unavailable []string
	for _, session := range inventory.Sessions {
		if session.Saved || !sessions[session.Target] {
			continue
		}
		var detail struct {
			Windows []Window `json:"windows"`
		}
		if err := c.request("GET", "/api/tuios?session="+url.QueryEscape(session.Target), nil, &detail); err != nil {
			unavailable = append(unavailable, fmt.Sprintf("%s: %v", session.Target, err))
			continue
		}
		for _, window := range detail.Windows {
			agent, ok := owned[window.ID]
			if !ok {
				continue
			}
			window.Session = session.Target
			if window.Name == "" {
				window.Name = window.Title
			}
			if window.Name == "" {
				window.Name = agent.Name
			}
			windows = append(windows, window)
		}
	}
	if len(unavailable) > 0 {
		return windows, fmt.Errorf("some task sessions are unavailable: %s", strings.Join(unavailable, "; "))
	}
	return windows, nil
}
