package tui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"tuios-inbox/internal/inbox"
)

const (
	hitNewTask = -1<<30 + iota
	hitNewWindow
	hitNewSession
	hitSubmit
	hitChoose
)

// hit is a clickable cell range in body coordinates; id is a task index, -(window index)-1, or a hit constant.
type hit struct{ id, x0, x1, y int }

var (
	accent = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("6"))
	dim    = lipgloss.NewStyle().Faint(true)
	good   = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	warn   = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	focus  = lipgloss.NewStyle().Reverse(true)
	marked = lipgloss.NewStyle().Bold(true)
)

func fit(s string, w int) string {
	if w <= 0 {
		return ""
	}
	s = ansi.Truncate(s, w, "…")
	if pad := w - ansi.StringWidth(s); pad > 0 {
		s += strings.Repeat(" ", pad)
	}
	return s
}

func (m *Model) width() int { return max(m.w, 1) }

// tight is a screen too short for optional chrome: rules, descriptions, toolbar and info line give way to the fields and status.
func (m *Model) tight() bool { return m.h > 0 && m.h < 12 }

// headerRows is the title plus, when there is room, a rule under it.
func (m *Model) headerRows() int {
	if m.tight() {
		return 1
	}
	return 2
}

func (m *Model) split() bool { return m.width() >= 66 && m.Form != formChoose }

func (m *Model) home(task inbox.Task) string {
	home := task.Session
	if task.Workspace != nil {
		home += fmt.Sprintf(" / w%d", *task.Workspace)
	}
	return home
}

func formTitle(f form) string {
	switch f {
	case formNewTask:
		return "New task"
	case formNewWindow:
		return "New window"
	case formNewSession:
		return "New session"
	case formChoose:
		return "Choose a task"
	}
	return "Task workspace"
}

func (m *Model) hints() string {
	short := m.width() < 56
	switch m.Form {
	case formNewWindow, formNewSession:
		if short {
			return "⏎ create · tab task · ^n new · esc back"
		}
		return "⏎ create · tab choose task · ^n new task · esc back"
	case formNewTask:
		return "⏎ create · esc back"
	case formChoose:
		return "⏎ choose · ^n new task · esc back"
	}
	if short {
		return "tab pane · ⏎ open · / find · n w s new · esc"
	}
	return "tab tasks/windows · ↑↓ move · ⏎ open · / find · r refresh · esc close"
}

// rowCount is how many list rows fit below the fixed chrome.
func (m *Model) rowCount() int {
	if m.Form != formBrowse && m.Form != formChoose {
		return 0
	}
	lines, _ := m.layout(0)
	return max(m.h-m.headerRows()-len(lines)-1, 1)
}

func (m *Model) message() string {
	switch {
	case m.Error != "":
		return warn.Render(printable(m.Error))
	case m.Jumping:
		return dim.Render("Jumping…")
	case m.Writing:
		return dim.Render("Creating… Esc leaves the request running.")
	case m.Busy && m.Notice == "":
		return dim.Render("Loading task windows… You can keep typing.")
	case m.Notice != "":
		return good.Render(printable(m.Notice))
	}
	return ""
}

// editLine draws the field with the cursor kept visible when the text is longer than the row.
func editLine(e lineEdit, width int) string {
	prefix, rest := e.Text[:e.Cursor], e.Text[e.Cursor:]
	under := " "
	if rest != "" {
		under = string([]rune(rest)[0])
		rest = rest[len(under):]
	}
	room := max(width-1, 0)
	if w := ansi.StringWidth(prefix); w > room {
		prefix = ansi.Cut(prefix, w-room, w)
	}
	rest = ansi.Truncate(rest, max(room-ansi.StringWidth(prefix), 0), "")
	return fit(prefix+focus.Render(under)+rest, width)
}

// layout builds the body below the header (title and rule). count is the number of list rows.
func (m *Model) layout(count int) ([]string, []hit) {
	width := m.width()
	var lines []string
	var hits []hit
	addHit := func(id, x, y, w int) { hits = append(hits, hit{id, x, x + w, y}) }
	text := func(s string) string { return fit(s, width) }
	tight := m.tight()
	compact := m.h > 0 && m.h < 18
	task, _ := m.task()
	switch m.Form {
	case formNewTask, formNewWindow, formNewSession:
		if m.Form == formNewTask && !m.tight() {
			lines = append(lines, text("Give the task a name. Its execution home is created when needed."))
		} else if m.tight() {
			lines = append(lines, text("Task: "+printable(task.Title)))
		} else {
			lines = append(lines, text("Task: "+printable(task.Title)))
			const choose, create = "[tab] Choose task", "[^n] New task"
			lines = append(lines, text(choose+"   "+create))
			addHit(hitChoose, 0, len(lines)-1, min(len(choose), width))
			x := len(choose) + 3
			addHit(hitNewTask, x, len(lines)-1, max(min(len(create), width-x), 0))
		}
		if !m.tight() {
			lines = append(lines, text(dim.Render(strings.Repeat("─", width))))
		}
		lines = append(lines, text("Name"), editLine(m.Draft, width))
		if m.Form == formNewWindow && !compact {
			lines = append(lines, text("Create in "+m.home(task)))
		}
		if m.Form == formNewSession && !compact {
			lines = append(lines, text("Assign the starter window and set this as the task's default home."), text("Previously assigned windows stay with this task."))
		}
		if !compact {
			lines = append(lines, text(""))
		}
		lines = append(lines, text("[Enter] "+formTitle(m.Form)))
		addHit(hitSubmit, 0, len(lines)-1, width)
	default:
		actions := []struct {
			Text string
			ID   int
		}{{"[n] New task", hitNewTask}, {"[w] New window", hitNewWindow}, {"[s] New session", hitNewSession}}
		if width < 66 {
			actions[0].Text, actions[1].Text, actions[2].Text = "[n] Task", "[w] Window", "[s] Session"
		}
		if m.Form == formChoose || m.Search {
			actions = actions[:1]
			actions[0].Text = "[^n] New task"
			if width < 66 {
				actions[0].Text = "[^n] Task"
			}
		}
		var toolbar strings.Builder
		if tight {
			actions = nil
		}
		for _, action := range actions {
			x := lipgloss.Width(toolbar.String())
			label := accent.Render(action.Text)
			if x > 0 && x+lipgloss.Width(label) > width {
				lines = append(lines, text(toolbar.String()))
				toolbar.Reset()
				x = 0
			}
			addHit(action.ID, x, len(lines), lipgloss.Width(label))
			toolbar.WriteString(label + "   ")
		}
		if !tight {
			lines = append(lines, text(toolbar.String()), text(dim.Render(strings.Repeat("─", width))))
		}
		if m.Search || m.Form == formChoose {
			lines = append(lines, editLine(m.Filter, width))
		} else if !tight {
			lines = append(lines, text(dim.Render("/ Find a task    •    Enter selects its windows")))
		}
		tasks := m.tasks()
		left, right := width, width
		if m.split() {
			left = min(width/3, 32)
			right = width - left - 3
		}
		columnTitle := "Tasks"
		if !m.split() && m.PaneFocus {
			columnTitle = printable(task.Title) + " — windows"
		}
		header := accent.Render(columnTitle)
		if m.split() {
			header = fit(header, left) + dim.Render(" │ ") + accent.Render(ansi.Truncate(printable(task.Title)+" — windows", right, "…"))
		}
		lines = append(lines, text(header))
		for row := range count {
			y := len(lines)
			taskIndex, windowIndex := m.TaskScroll+row, m.WindowScroll+row
			taskLine := fit("", left)
			if taskIndex < len(tasks) {
				taskLine = m.row(" "+printable(tasks[taskIndex].Title), left, taskIndex == m.TaskCursor, !m.PaneFocus || m.Form == formChoose)
			} else if row == 0 {
				taskLine = fit(dim.Render("No tasks. Press n to create one."), left)
			}
			windowLine := fit("", right)
			if windowIndex < len(m.Windows) {
				window := m.Windows[windowIndex]
				label := fmt.Sprintf(" %s  ·  %s / w%d", printable(window.Name), printable(window.Session), window.Workspace)
				windowLine = m.row(label, right, windowIndex == m.WindowCursor, m.PaneFocus)
			} else if row == 0 {
				empty := "No assigned live windows. Press w to create one."
				if m.Busy {
					empty = "Loading task windows…"
				}
				windowLine = fit(dim.Render(empty), right)
			}
			switch {
			case m.split():
				lines = append(lines, taskLine+dim.Render(" │ ")+windowLine)
				if taskIndex < len(tasks) {
					addHit(taskIndex, 0, y, left)
				}
				if windowIndex < len(m.Windows) {
					addHit(-windowIndex-1, left+3, y, right)
				}
			case m.PaneFocus:
				lines = append(lines, windowLine)
				if windowIndex < len(m.Windows) {
					addHit(-windowIndex-1, 0, y, right)
				}
			default:
				lines = append(lines, taskLine)
				if taskIndex < len(tasks) {
					addHit(taskIndex, 0, y, left)
				}
			}
		}
		info := "Select a task to see its windows."
		if task.ID != "" {
			info = fmt.Sprintf("%s · %d live windows · home %s", task.Status, len(m.Windows), m.home(task))
		}
		if !tight {
			lines = append(lines, text(info))
		}
	}
	lines = append(lines, text(m.message()))
	for i := range hits {
		hits[i].y += m.headerRows()
	}
	return lines, hits
}

func (m *Model) row(s string, width int, cursor, focused bool) string {
	s = fit(s, width)
	switch {
	case cursor && focused:
		return focus.Render(s)
	case cursor:
		return marked.Render(s)
	}
	return s
}

// View draws the title, the body and a one-line key reference, clipped to the screen.
func (m *Model) View() tea.View {
	width := m.width()
	lines := []string{accent.Render(fit(formTitle(m.Form), width))}
	if m.headerRows() > 1 {
		lines = append(lines, dim.Render(strings.Repeat("─", width)))
	}
	body, _ := m.layout(m.rowCount())
	status := body[len(body)-1]
	lines = append(lines, body[:len(body)-1]...)
	if m.h > 0 {
		for len(lines) < m.h-2 {
			lines = append(lines, "")
		}
		lines = lines[:min(len(lines), m.h-2)]
		if m.h == 1 {
			lines = nil
		}
	}
	if m.h != 1 {
		lines = append(lines, status)
	}
	lines = append(lines, dim.Render(ansi.Truncate(m.hints(), width, "…")))
	view := tea.NewView(strings.Join(lines, "\n"))
	view.AltScreen = true
	view.MouseMode = tea.MouseModeCellMotion
	return view
}
