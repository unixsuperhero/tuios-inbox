// Package tui is the standalone task workspace: tasks on the left, their live windows on the right.
package tui

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"tuios-inbox/internal/inbox"
)

type form uint8

const (
	formBrowse form = iota
	formNewTask
	formNewWindow
	formNewSession
	formChoose
)

// Config carries everything the launcher decides.
type Config struct {
	Client   *inbox.Client
	ClientID string // opaque TUIOS client that launched this popup; empty outside a popup
	TUIOSBin string
}

// Model is the Bubble Tea model. State is in-memory only.
type Model struct {
	cfg Config

	w, h int

	Busy, Writing, Jumping, Search, PaneFocus bool
	Gen                                       uint64
	Snapshot                                  inbox.Snapshot
	Windows                                   []inbox.Window
	TaskID                                    string
	TaskCursor, WindowCursor                  int
	TaskScroll, WindowScroll                  int
	Form, Continue                            form
	Draft, Filter                             lineEdit
	Error, Notice                             string

	// Parent stores the form and browsing context beneath task choice or inline task creation.
	// Its zero form marks mandatory first-task creation started directly from browse.
	Parent parentContext

	// ExitNote is printed by the launcher after the program ends.
	ExitNote string
}

// parentContext is what cancelling the chooser or inline task creation must put back.
type parentContext struct {
	Form                       form
	Draft                      lineEdit
	TaskID                     string
	Windows                    []inbox.Window
	TaskCursor, TaskScroll     int
	WindowCursor, WindowScroll int
	PaneFocus                  bool
	Filter                     lineEdit
}

type loadMsg struct {
	Gen      uint64
	Snapshot *inbox.Snapshot
	Windows  []inbox.Window
	TaskID   string
	Created  *inbox.Task
	Notice   string
	Err      error
}

type jumpMsg struct {
	Gen uint64
	Err error
}

// New returns a model that loads on Init.
func New(cfg Config) *Model { return &Model{cfg: cfg} }

func (m *Model) Init() tea.Cmd { return m.load() }

func (m *Model) tasks() []inbox.Task {
	var tasks []inbox.Task
	for _, task := range m.Snapshot.Tasks {
		if task.Archived == 0 {
			tasks = append(tasks, task)
		}
	}
	return filterTasks(tasks, m.Filter.Text)
}

func (m *Model) task() (inbox.Task, bool) {
	for _, task := range m.Snapshot.Tasks {
		if task.ID == m.TaskID && task.Archived == 0 {
			return task, true
		}
	}
	return inbox.Task{}, false
}

func (m *Model) candidate() (inbox.Task, bool) {
	tasks := m.tasks()
	if len(tasks) == 0 {
		return inbox.Task{}, false
	}
	m.TaskCursor = clamp(m.TaskCursor, 0, len(tasks)-1)
	return tasks[m.TaskCursor], true
}

func (m *Model) load() tea.Cmd {
	m.Busy = true
	m.Writing = false
	m.Gen++
	gen, taskID := m.Gen, m.TaskID
	allowFallback := m.Form == formBrowse
	client := m.cfg.Client
	return func() tea.Msg {
		snapshot, err := client.State()
		if err != nil {
			return loadMsg{Gen: gen, Err: err}
		}
		valid := false
		for _, task := range snapshot.Tasks {
			if task.ID == taskID && task.Archived == 0 {
				valid = true
			}
		}
		if !valid {
			if !allowFallback {
				return loadMsg{Gen: gen, Snapshot: &snapshot, TaskID: taskID, Err: fmt.Errorf("selected task is unavailable; choose or create another task")}
			}
			taskID = ""
			for _, task := range snapshot.Tasks {
				if task.Archived == 0 {
					taskID = task.ID
					break
				}
			}
		}
		var windows []inbox.Window
		if taskID != "" {
			windows, err = client.Windows(snapshot, taskID)
		}
		return loadMsg{Gen: gen, Snapshot: &snapshot, TaskID: taskID, Windows: windows, Err: err}
	}
}

func (m *Model) handleLoad(msg loadMsg) tea.Cmd {
	if msg.Gen != m.Gen {
		return nil
	}
	m.Busy = false
	m.Writing = false
	m.Error = ""
	if msg.Err != nil {
		m.Error = msg.Err.Error()
	}
	if msg.Snapshot != nil {
		candidate, _ := m.candidate()
		m.Snapshot = *msg.Snapshot
		m.TaskID = msg.TaskID
		m.Windows = msg.Windows
		if candidate.ID == "" {
			candidate.ID = m.TaskID
		}
		for i, task := range m.tasks() {
			if task.ID == candidate.ID {
				m.TaskCursor = i
				break
			}
		}
		m.WindowCursor = clamp(m.WindowCursor, 0, max(len(m.Windows)-1, 0))
		return nil
	}
	if msg.Err != nil {
		return nil
	}
	m.Notice = msg.Notice
	if msg.Created != nil {
		m.setTask(msg.Created.ID)
		m.Snapshot.Tasks = append([]inbox.Task{*msg.Created}, m.Snapshot.Tasks...)
		m.TaskCursor = 0
		m.Form = m.Continue
		m.Continue = formBrowse
		m.Draft = m.Parent.Draft
		m.Parent = parentContext{}
	} else {
		m.Form = formBrowse
		m.Parent = parentContext{}
		m.Draft = lineEdit{}
		m.PaneFocus = true
	}
	m.Filter = lineEdit{}
	m.Search = false
	return m.load()
}

// setTask changes scope and drops the previous task's windows so they are never shown under the new one.
func (m *Model) setTask(id string) {
	if m.TaskID != id {
		m.Windows = nil
		m.WindowCursor = 0
		m.WindowScroll = 0
	}
	m.TaskID = id
	m.Gen++
	m.Busy = false
}

func (m *Model) beginForm(f form) {
	m.Error = ""
	m.Notice = ""
	m.setTask(m.TaskID)
	if f != formNewTask {
		if !m.PaneFocus {
			if task, ok := m.candidate(); ok {
				m.setTask(task.ID)
			}
		}
		if _, ok := m.task(); !ok {
			m.Continue = f
			f = formNewTask
		}
	}
	m.Form = f
	m.Draft = lineEdit{}
	m.Search = false
}

func (m *Model) submit() tea.Cmd {
	name := strings.TrimSpace(m.Draft.Text)
	if name == "" {
		m.Error = "Enter a name to create it."
		return nil
	}
	f, taskID := m.Form, m.TaskID
	if f != formNewTask {
		if _, ok := m.task(); !ok {
			m.Error = "Choose or create a task first."
			return nil
		}
	}
	m.Busy = true
	m.Writing = true
	m.Error = ""
	m.Gen++
	gen := m.Gen
	client := m.cfg.Client
	return func() tea.Msg {
		result := loadMsg{Gen: gen}
		switch f {
		case formNewTask:
			task, err := client.CreateTask(name)
			result.Err = err
			if err == nil {
				result.Created = &task
			}
			result.Notice = "Task created: " + name
		case formNewWindow:
			result.Err = client.CreateWindow(taskID, name)
			result.Notice = "Window created: " + name
		case formNewSession:
			result.Err = client.CreateSession(taskID, name)
			result.Notice = "Session created: " + name
		}
		return result
	}
}

func (m *Model) move(delta int) {
	if m.Writing || (m.Form != formBrowse && m.Form != formChoose) {
		return
	}
	if m.PaneFocus && m.Form != formChoose {
		m.WindowCursor = clamp(m.WindowCursor+delta, 0, max(len(m.Windows)-1, 0))
	} else {
		m.TaskCursor = clamp(m.TaskCursor+delta, 0, max(len(m.tasks())-1, 0))
	}
}

func (m *Model) activate() tea.Cmd {
	task, ok := m.candidate()
	if !ok {
		return nil
	}
	m.setTask(task.ID)
	m.PaneFocus = true
	m.WindowCursor = 0
	m.WindowScroll = 0
	m.Search = false
	if m.Form == formChoose {
		m.Form = m.Continue
		m.Continue = formBrowse
		m.Draft = m.Parent.Draft
		m.Parent = parentContext{}
	}
	return m.load()
}

// jump runs the generic TUIOS navigation command. The app exits only when it confirms success.
func (m *Model) jump() tea.Cmd {
	if m.Writing || m.Jumping || m.WindowCursor < 0 || m.WindowCursor >= len(m.Windows) {
		return nil
	}
	if m.cfg.ClientID == "" {
		m.Error = "Jumping needs the TUIOS client that opened this window: launch it from a TUIOS popup or pass --client."
		return nil
	}
	window := m.Windows[m.WindowCursor]
	session := window.Session
	if !strings.Contains(session, ":") {
		session = "local:" + session
	}
	m.Error = ""
	m.Notice = ""
	m.Jumping = true
	m.Busy = false
	m.Gen++
	gen := m.Gen
	bin, clientID := m.cfg.TUIOSBin, m.cfg.ClientID
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, bin, "jump-window", "--client", clientID, "--session", session, window.ID).CombinedOutput()
		if err != nil {
			detail := strings.TrimSpace(string(out))
			if detail == "" {
				detail = err.Error()
			}
			return jumpMsg{Gen: gen, Err: fmt.Errorf("jump failed: %s", detail)}
		}
		return jumpMsg{Gen: gen}
	}
}

// openFromForm leaves the current window/session form for the chooser or inline task creation.
func (m *Model) openFromForm(next form) {
	m.Parent = parentContext{
		Form: m.Form, Draft: m.Draft, TaskID: m.TaskID, Windows: m.Windows,
		TaskCursor: m.TaskCursor, TaskScroll: m.TaskScroll,
		WindowCursor: m.WindowCursor, WindowScroll: m.WindowScroll,
		PaneFocus: m.PaneFocus, Filter: m.Filter,
	}
	m.Continue = m.Form
	m.Form = next
	m.Draft = lineEdit{}
}

// back cancels the chooser or inline task creation and restores the form and browsing context under it.
func (m *Model) back() {
	p := m.Parent
	m.Parent = parentContext{}
	m.Form = p.Form
	m.Continue = formBrowse
	m.Draft = p.Draft
	m.TaskID, m.Windows = p.TaskID, p.Windows
	m.TaskCursor, m.TaskScroll = p.TaskCursor, p.TaskScroll
	m.WindowCursor, m.WindowScroll = p.WindowCursor, p.WindowScroll
	m.PaneFocus, m.Filter = p.PaneFocus, p.Filter
	m.Search = false
	m.Gen++
	m.Busy = false
}

func (m *Model) handleKey(key, text string) tea.Cmd {
	if m.Jumping {
		if key == "esc" || key == "ctrl+c" {
			return tea.Quit
		}
		return nil
	}
	if key == "esc" || key == "ctrl+c" {
		if m.Writing {
			m.ExitNote = "Closed while a create request was in flight; the Inbox server may still complete it."
			return tea.Quit
		}
		if (m.Form == formNewTask || m.Form == formChoose) && m.Parent.Form != formBrowse {
			m.back()
		} else if m.Form != formBrowse {
			m.Form = formBrowse
			m.Continue = formBrowse
			m.Parent = parentContext{}
			m.Draft = lineEdit{}
			m.Error = ""
			return m.load()
		} else if m.Search || m.Filter.Text != "" {
			m.Search = false
			m.Filter = lineEdit{}
			m.TaskCursor = 0
		} else {
			return tea.Quit
		}
		m.Error = ""
		return nil
	}
	if m.Writing {
		return nil
	}
	if m.Form == formNewWindow || m.Form == formNewSession {
		switch key {
		case "ctrl+n":
			m.openFromForm(formNewTask)
			m.setTask(m.TaskID)
			return nil
		case "tab":
			m.openFromForm(formChoose)
			m.Filter = lineEdit{}
			m.TaskCursor = 0
			m.PaneFocus = false
			return nil
		}
	}
	if m.Form == formNewTask || m.Form == formNewWindow || m.Form == formNewSession {
		if key == "enter" {
			return m.submit()
		}
		m.Draft.key(key, text)
		return nil
	}
	if m.Search || m.Form == formChoose {
		switch key {
		case "enter":
			return m.activate()
		case "up":
			m.move(-1)
		case "down":
			m.move(1)
		case "ctrl+n":
			if m.Form == formChoose {
				m.Form = formNewTask
				m.Draft = lineEdit{}
				m.setTask(m.TaskID)
			} else {
				m.beginForm(formNewTask)
			}
		default:
			m.Filter.key(key, text)
			m.TaskCursor = 0
			m.TaskScroll = 0
		}
		return nil
	}
	switch key {
	case "n", "ctrl+n":
		m.beginForm(formNewTask)
	case "w":
		m.beginForm(formNewWindow)
	case "s":
		m.beginForm(formNewSession)
	case "r":
		return m.load()
	case "/":
		m.Search = true
		m.PaneFocus = false
		m.Filter = lineEdit{}
		m.TaskCursor = 0
	case "tab", "shift+tab", "left", "right":
		m.PaneFocus = !m.PaneFocus
	case "up", "k":
		m.move(-1)
	case "down", "j":
		m.move(1)
	case "enter":
		if m.PaneFocus {
			return m.jump()
		}
		return m.activate()
	}
	return nil
}

func (m *Model) handleClick(x, y int) tea.Cmd {
	if m.Writing || m.Jumping {
		return nil
	}
	_, hits := m.layout(m.rowCount())
	for _, hit := range hits {
		if x >= hit.x0 && x < hit.x1 && y == hit.y {
			return m.click(hit.id)
		}
	}
	return nil
}

func (m *Model) click(id int) tea.Cmd {
	switch id {
	case hitNewTask:
		return m.handleKey("ctrl+n", "")
	case hitNewWindow:
		m.beginForm(formNewWindow)
	case hitNewSession:
		m.beginForm(formNewSession)
	case hitSubmit:
		return m.handleKey("enter", "")
	case hitChoose:
		return m.handleKey("tab", "")
	default:
		if id < 0 {
			m.PaneFocus = true
			m.WindowCursor = -id - 1
			return m.jump()
		}
		m.PaneFocus = false
		m.TaskCursor = id
		return m.activate()
	}
	return nil
}

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
	case loadMsg:
		cmd = m.handleLoad(msg)
	case jumpMsg:
		if msg.Gen == m.Gen && m.Jumping {
			m.Jumping = false
			if msg.Err != nil {
				m.Error = msg.Err.Error()
			} else {
				cmd = tea.Quit
			}
		}
	case tea.KeyPressMsg:
		cmd = m.handleKey(msg.String(), msg.Text)
	case tea.PasteMsg:
		if m.Writing || m.Jumping {
			break
		}
		if m.Form == formNewTask || m.Form == formNewWindow || m.Form == formNewSession {
			m.Draft.insert(msg.Content)
		} else if m.Search || m.Form == formChoose {
			m.Filter.insert(msg.Content)
			m.TaskCursor = 0
		}
	case tea.MouseClickMsg:
		if msg.Button == tea.MouseLeft {
			cmd = m.handleClick(msg.X, msg.Y)
		}
	case tea.MouseWheelMsg:
		switch msg.Button {
		case tea.MouseWheelUp:
			m.move(-1)
		case tea.MouseWheelDown:
			m.move(1)
		}
	}
	m.normalize()
	return m, cmd
}

func clamp(v, lo, hi int) int { return max(lo, min(v, hi)) }

func scrollWindow(scroll, cursor, total, count int) int {
	if count <= 0 || total <= count {
		return 0
	}
	if cursor < scroll {
		scroll = cursor
	} else if cursor >= scroll+count {
		scroll = cursor - count + 1
	}
	return clamp(scroll, 0, total-count)
}

// normalize keeps cursors and scroll offsets valid for the current data and screen.
func (m *Model) normalize() {
	count := m.rowCount()
	tasks := m.tasks()
	m.TaskCursor = clamp(m.TaskCursor, 0, max(len(tasks)-1, 0))
	m.WindowCursor = clamp(m.WindowCursor, 0, max(len(m.Windows)-1, 0))
	m.TaskScroll = scrollWindow(m.TaskScroll, m.TaskCursor, len(tasks), count)
	m.WindowScroll = scrollWindow(m.WindowScroll, m.WindowCursor, len(m.Windows), count)
}
