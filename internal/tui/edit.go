package tui

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// lineEdit is a single-line UTF-8 editor; Cursor is a byte offset on a rune boundary.
type lineEdit struct {
	Text   string
	Cursor int
}

func (e *lineEdit) insert(text string) {
	text = strings.Map(func(r rune) rune {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			return ' '
		case unicode.IsControl(r):
			return -1
		}
		return r
	}, text)
	e.Text = e.Text[:e.Cursor] + text + e.Text[e.Cursor:]
	e.Cursor += len(text)
}

func (e *lineEdit) key(key, text string) {
	switch key {
	case "left":
		if e.Cursor > 0 {
			_, n := utf8.DecodeLastRuneInString(e.Text[:e.Cursor])
			e.Cursor -= n
		}
	case "right":
		if e.Cursor < len(e.Text) {
			_, n := utf8.DecodeRuneInString(e.Text[e.Cursor:])
			e.Cursor += n
		}
	case "home", "ctrl+a":
		e.Cursor = 0
	case "end", "ctrl+e":
		e.Cursor = len(e.Text)
	case "backspace":
		if e.Cursor > 0 {
			_, n := utf8.DecodeLastRuneInString(e.Text[:e.Cursor])
			e.Text = e.Text[:e.Cursor-n] + e.Text[e.Cursor:]
			e.Cursor -= n
		}
	case "delete":
		if e.Cursor < len(e.Text) {
			_, n := utf8.DecodeRuneInString(e.Text[e.Cursor:])
			e.Text = e.Text[:e.Cursor] + e.Text[e.Cursor+n:]
		}
	case "ctrl+u":
		*e = lineEdit{}
	default:
		e.insert(text)
	}
}
