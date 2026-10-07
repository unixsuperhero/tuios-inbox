// Command tuios-inbox-tui is a terminal task workspace for the tuios-inbox server.
package main

import (
	"flag"
	"fmt"
	"os"

	tea "charm.land/bubbletea/v2"

	"tuios-inbox/internal/inbox"
	"tuios-inbox/internal/tui"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func main() {
	flags := flag.NewFlagSet("tuios-inbox-tui", flag.ContinueOnError)
	url := flags.String("url", env("TUIOS_INBOX_URL", "http://127.0.0.1:4399"), "tuios-inbox server URL (env TUIOS_INBOX_URL)")
	client := flags.String("client", os.Getenv("TUIOS_CLIENT_ID"), "TUIOS client to navigate when jumping to a window (env TUIOS_CLIENT_ID)")
	bin := flags.String("tuios-bin", env("TUIOS_BIN", "tuios"), "tuios executable used for jump-window (env TUIOS_BIN)")
	flags.Usage = func() {
		fmt.Fprintf(flags.Output(), "Usage: tuios-inbox-tui [--url URL] [--client ID] [--tuios-bin PATH]\n\nTask workspace for tuios-inbox. Run it as a TUIOS popup to jump to a task's windows.\n\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(os.Args[1:]); err != nil {
		if err == flag.ErrHelp {
			return
		}
		os.Exit(2)
	}
	if flags.NArg() > 0 {
		flags.Usage()
		os.Exit(2)
	}
	model := tui.New(tui.Config{Client: inbox.New(*url), ClientID: *client, TUIOSBin: *bin})
	if _, err := tea.NewProgram(model).Run(); err != nil {
		fmt.Fprintln(os.Stderr, "tuios-inbox-tui:", err)
		os.Exit(1)
	}
	if model.ExitNote != "" {
		fmt.Fprintln(os.Stderr, model.ExitNote)
	}
}
