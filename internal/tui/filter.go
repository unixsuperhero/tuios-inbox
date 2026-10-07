package tui

import (
	"sort"
	"strings"

	"tuios-inbox/internal/inbox"
)

// filterTasks keeps tasks whose title contains the query, then those that contain it as a
// subsequence. Substring hits rank by position; ties keep the server's order.
func filterTasks(tasks []inbox.Task, query string) []inbox.Task {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return tasks
	}
	type hit struct {
		task  inbox.Task
		score int
	}
	var hits []hit
	needle := []rune(query)
	for _, task := range tasks {
		title := strings.ToLower(task.Title)
		if at := strings.Index(title, query); at >= 0 {
			hits = append(hits, hit{task, len([]rune(title[:at]))})
			continue
		}
		next, first, last := 0, -1, 0
		for i, r := range []rune(title) {
			if next < len(needle) && r == needle[next] {
				if first < 0 {
					first = i
				}
				last = i
				next++
			}
		}
		if next == len(needle) {
			hits = append(hits, hit{task, 10000 + last - first})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score < hits[j].score })
	out := make([]inbox.Task, len(hits))
	for i, h := range hits {
		out[i] = h.task
	}
	return out
}

// printable makes a title safe to draw on one line.
func printable(s string) string {
	return strings.Join(strings.Fields(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0) {
			return ' '
		}
		return r
	}, s)), " ")
}
