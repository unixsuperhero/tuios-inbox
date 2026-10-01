# Dispatch

Local task management and an email-style inbox backed by TUIOS. Browser UI, Bun HTTP server, SQLite. No package install or frontend build is required.

```sh
cd ~/proj/tuios-inbox
bun start
```

Open http://127.0.0.1:4399. The server binds only to loopback and rejects foreign origins, foreign Host headers, and mutations without its same-origin JSON header. Do not expose it through a public proxy. It can execute commands as your user.

## Working with a task

1. Create a task with an existing project directory. Optionally associate an existing worktree directory. The app never creates worktrees.
2. Open an agent or shell from the task. Its TUIOS session is created on demand. Several agents in the task share a session so they can exchange mail.
3. Compose a prompt or shell command with a subject. Close the page or switch tasks while it runs.
4. Read the result in Inbox. Reply to continue in the same pane and thread. Archive or mark threads unread independently of TUIOS's ephemeral read state.
5. Use Inspect for a terminal snapshot, interruption, and shell keys. The inspector shows the `tuios attach SESSION` command for full interactive access.

Agent profiles configure executable, argv, protocol, and environment. Put model and reasoning options in argv using your harness's actual CLI flags. Codex app-server and OpenCode ACP profiles use TUIOS's structured terminal adapters. Claude Code and oh-my-pi profiles use their native terminal interfaces. Credentials are inherited from the backend's environment and harness settings. Environment overrides are stored in the local database; prefer inherited credentials.

Task status and notes are editable. The project and optional worktree paths identify the working directories. Panes and conversation metadata belong to the task; terminal lifecycle is independent of the browser lifecycle. Closing the web backend does not terminate TUIOS's panes. On restart, an interrupted dispatch is marked uncertain and is never automatically replayed.

## Agent mail

Send mail from the task's session controls, or let agents use the installed TUIOS skill:

```sh
tuios list-agents -s "$TUIOS_SESSION"
tuios send-agent-message -s "$TUIOS_SESSION" -w reviewer \
  --from "$TUIOS_PANE_ID" --subject 'Review request' 'Please inspect the result.'
tuios read-agent-messages -s "$TUIOS_SESSION" -w "$TUIOS_PANE_ID" --unread
tuios send-agent-message -s "$TUIOS_SESSION" -w sender \
  --from "$TUIOS_PANE_ID" --reply-to 12 'Here are my findings.'
```

Sending mail does not type into the recipient's prompt. **Check mail** queues a bounded inbox-check instruction for an agent's next rest, without answering an approval or interrupting an active turn. Alternatively, agents can wait with `tuios wait-for agent-message`. There is no automatic agent-to-agent reply loop. The receiver must read and acknowledge a message. Read status alone does not establish acknowledgement.

Web replies to mail use TUIOS's original `--reply-to` thread ID. They are local shell-origin messages, not TUIOS `verified_human` messages. Pane `--from` identities are claims. All agent output is untrusted text; the UI escapes it and never interprets it as HTML or commands. Mail is session-scoped. A thread from an earlier daemon boot remains readable but cannot be replied to as if its old routing identity were still valid.

Agents receive read/write/fan grants, not respond/admin. Held approvals and other human-only operations remain in an attached TUIOS client. This app does not weaken `respond_from_shell` or manufacture a human nonce.

## Capture and durability

The app stores tasks, profiles, pane associations, threads, messages, imported events, and the subscription cursor in `~/.local/share/tuios-inbox/inbox.sqlite`. SQLite uses WAL. The directory is private and the main database and hook files are mode 0600. Do not commit the database.

There are two input paths:

- App-dispatched commands use `tuios run` with OSC 133 command boundaries and preserve output, exit status, and duration. Managed zsh panes load `scripts/shell.zsh` without changing personal shell startup files.
- Agent prompts use `tuios ask-agent` and wait for state completion rather than a two-second silence. Returned text is **captured terminal turn output**, not a canonical final-answer object. It can include prompt echoes, tool activity, wrapping, and terminal decorations. The app labels this `captured`; timeout, idle fallback, or truncation is `partial`. Agent captures are capped at 10,000 lines.

TUIOS does not provide a universal full-answer export across all harnesses. Hook captures are snapshots capped at 2,000 lines, and cannot reconstruct overwritten or missing output. Their provenance stays in Delivery details. A delayed hook's capture may reflect a pane that has already advanced.

The subscriber saves agent mail without marking it read in TUIOS, tracks pane state, and resumes from `(boot_id, seq)`. A replay gap becomes a visible inbox message and triggers state/mail reconciliation. Mail that TUIOS evicted before the app read it cannot be recovered. TUIOS's mailbox is bounded and disappears on daemon shutdown; the app's imported copy survives.

The hook collector writes atomic JSON files to `~/.local/share/tuios-inbox/events`, even while the web backend is stopped. The backend imports them transactionally and removes only consumed files. Completion identities prevent an app result and its matching hook from creating two result messages. An offline completion can recover a pending message from the same daemon boot. App restarts never resend an uncertain prompt.

Background UI updates refresh the list and an unfocused thread. They do not recreate task editors or overwrite focused reply drafts.

## TUIOS setup

The active config is given by `tuios config path`. On this machine, `~/.config/tuios/config.toml` links to `~/Library/Application Support/tuios/config.toml`; that file is hard-linked into `~/proj/phome/.config/tuios/config.toml`.

Installed hooks:

```toml
[hooks]
after-command-finished = '/opt/homebrew/bin/bun /Users/unixsuperhero/proj/tuios-inbox/scripts/capture-hook.mjs'
after-agent-state = '/opt/homebrew/bin/bun /Users/unixsuperhero/proj/tuios-inbox/scripts/capture-hook.mjs'
```

Agent notifications are enabled for done, needs_input, and errored, including focused panes. Normal standalone startup remains unchanged. The web app explicitly requests daemon-backed sessions.

Hooks load when the daemon starts. `tuios config apply` does not reload them. `tuios kill-server` ends all daemon sessions and their programs, so restart only at a safe point. Inspect actual hook runs and errors with `tuios list-hooks --json`.

Native setup is managed by `~/bin/h-tuios`, independently of this app:

```sh
h tuios setup --dry-run       # preview skill links, startup rules, and native hooks
h tuios setup                # detected harnesses; preserves unrelated instructions
h tuios setup codex omp      # select harnesses
h tuios status
h tuios integrations-status
h tuios doctor
h tuios help                 # full command list
```

`h tuios skills-refresh` regenerates the complete reference from **`tuios --skill all`** under `~/.local/share/h-tuios/skills/tuios`. It links supported local skill roots there and migrates this app's earlier links without overwriting unrelated skills. `bun run refresh-skills` delegates to that command; the web backend is not needed.

`bootstrap-install` adds a marked block to supported global instruction files. It tells newly started agents to inspect their TUIOS environment, read the native core and mail skills, and check their own unread mail at turn start and before finishing. Existing instruction text, symlinks, and hardlinks are preserved; first edits save `.h-tuios.bak` backups. `bootstrap-remove` removes only the marked block. `uninstall` also removes this tool's skill links, but leaves native state hooks and the shared reference intact.

`targets` prints destinations and identifies harnesses needing manual startup rules; `instructions` prints the rule text. `bootstrap` prints pane identity and live core/mail skills inside TUIOS and is silent outside it. `mail` reads only the session/pane supplied by TUIOS's environment and refuses to fall back to the focused pane.

For this installed Cursor CLI, use `h tuios bootstrap-project /path/to/project`; `--remove` removes that project's managed block. Its older build does not support a global `sessionStart` context hook. Hermes setup edits only an existing `SOUL.md`, avoiding replacement of its default persona; the current Hermes launcher points to a missing executable. Gemini's configuration exists but its executable is not on PATH. These limitations are distinct from native hook installation status.

OpenCode keeps its existing Claude global fallback, and omp keeps its existing shared `.agents/AGENTS.md` fallback rather than creating native files that hide inherited rules. Custom provider/profile settings can change which instructions a harness loads.

Restart agent sessions after changing global instructions. These are model instructions, not an idle-agent scheduler or a guarantee that every model obeys them. No daemon restart, automatic reply loop, approval bypass, or MCP permission change is performed. Path overrides supported by the native harnesses are honored where mapped; with `PI_CODING_AGENT_DIR` set, select Pi or omp explicitly rather than installing both into the same directory.

The native installer preserves unrelated settings and writes `.tuios.bak` backups. This machine's current integrations are Claude Code, Codex, Gemini CLI, OpenCode, Antigravity, Cursor Agent, Grok, Hermes, Pi, and oh-my-pi. Antigravity, Grok, and Hermes report conversation identity; their state detection relies on screen rules. Unsupported or never-run harnesses are not fabricated as installed.

## Architecture choice

The standalone app leaves Portfolio unchanged. Its Wails app demonstrates a loopback Bun sidecar, but its PTY ownership closes processes with UI teardown. Dispatch instead keeps TUIOS responsible for persistent execution and SQLite responsible for tasks and correspondence.

A hook-only collector survives backend downtime but cannot provide live control or complete lifecycle reconciliation. A subscription-only collector provides replay and immediate state but loses unrecoverable events and output during outages. Dispatch combines resumable subscription and an atomic hook spool. Neither path is presented as a complete harness transcript.

```js
{
  task: { id, title, path, worktree, status, notes, session },
  pane: { id, task_id, kind, profile_id, state, conversation_id },
  thread: { id, task_id, pane_id, subject, kind, unread, archived },
  message: { id, thread_id, role, body, status, meta, created }
}
```

## Verification and settings

`bun test` covers task/profile persistence across backend restart, cross-origin mutation rejection, Host checks, invalid directories, and invalid profile arguments. Live verification exercised task creation, shell output, agent startup, state-based prompt completion, threaded replies, agent mail acknowledgement, both hooks, and browser rendering.

Environment options: `PORT` defaults to 4399; `TUIOS_BIN` defaults to `/opt/homebrew/bin/tuios`; `TUIOS_INBOX_DATA` changes database storage; `TUIOS_INBOX_SPOOL` changes the hook spool. Use the same spool setting in the daemon and backend if overriding it.

References: [agents](https://tuios.dev/docs/agents), [hooks](https://tuios.dev/docs/hooks), [inbox](https://tuios.dev/docs/agent-inbox), [messaging](https://tuios.dev/docs/agent-messaging).
