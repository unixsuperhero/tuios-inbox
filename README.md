# tuios inbox

Local task management and an email-style inbox backed by TUIOS. Browser UI, Bun HTTP server, SQLite. No package install or frontend build is required.

```sh
cd ~/proj/tuios-inbox
bun start
```

Open http://127.0.0.1:4399. The server binds only to loopback and rejects foreign origins, foreign Host headers, and mutations without its same-origin JSON header. Do not expose it through a public proxy. It can execute commands as your user.

Manage the background server from any directory with the local CLI:

```sh
h tuios start
h tuios status
h tuios stop
```

`h-tuios` accepts the same commands directly. Start waits for HTTP readiness and
reuses an existing Bun server in this project. Stop sends SIGTERM only after
checking the listener's executable, script, and working directory; it never
stops the TUIOS daemon or its panes. Repeated starts and stops are safe. Status
exits 0 when ready and 1 when stopped, unresponsive, or another process owns the
port. Use `PORT=4400 h tuios start` for another port and pass the same `PORT` to
status and stop. The server inherits the starting shell's environment and grants,
including `TUIOS_BIN`, `TUIOS_INBOX_DATA`, and `TUIOS_INBOX_SPOOL`. No permissions
are changed, and no login service or automatic restart is installed. Logs append
to `~/.local/state/h-tuios/server-PORT.log`. These commands require Bun, `lsof`,
and `ps`. The former harness-status command is now `h tuios setup-status [HARNESS...]`.

## Inbox

The default page is the live Task workbench. A narrow Task > Agent rail stays on the left, threads and records open in the main pane, and a separate review queue stays on the right. These are real SQLite records and native TUIOS recipients, not the sample comparisons. The rail is 15% wide at desktop sizes, bounded to 200–250px.

The review queue contains unread, unarchived finished responses and sorts oldest-first or newest-first independently of task navigation. Opening a response does not mark it read. **Reviewed**, **Review next**, or a successful reply records review; a failed reply preserves the pending response and draft. Native hash links support browser Back/Forward without undoing sent work or review decisions. Live refresh preserves focused controls, drafts, text selection, expanded details, and scroll position.

Turns, Tasks, Agents, Archive, and Agent profiles remain available in the top navigation. Their indexes retain shared search, filters (`is`, `is not`, `has`, `has no`), sort, multi-select, and bulk actions. Opening a work record navigates to its main-pane detail. Task and Agent pages contain factual, editable metadata and scoped history; scope uses Task IDs or native Agent/pane IDs, not display names or removable filter chips. On narrow screens, the bottom Tasks, Content, and Review buttons switch between the three work areas.

All is the default type selection and exclusive reset. Turns and Commands toggle independently; selecting both includes either type. The type union combines with search, filters, and sort. Selecting neither returns to All. Read and unread backgrounds describe state, never alternating stripes.

The global inline composer sends a prompt or shell command to a native recipient. It lists Agents once and only agentless Panes separately, deduplicated by native ID. Task, Agent, and Pane selectors offer matching New choices. Creation returns the real record to the initiating selector; cancel or failure preserves its selection context and typed draft. Agent selection waits for that startup thread and returned native pane to become ready. Failed or blocked startup is not presented as ready.

On the Agents page, assign a pane to a task. Its existing turns and commands move to that task, unless you moved one elsewhere by hand, and new ones inherit it.

```js
item:  { id: 'turn:…' | 'thread:…', type: 'turn' | 'command' | 'mail' | 'system' | 'dispatch' | 'snapshot',
         title, agent_id, agent_name, harness, task_id, status, unread, archived, created, updated }
agent: { id, session, name, harness, kind: 'agent' | 'shell', task_id, state, seen }
```

## Turns

A turn row appears with the prompt when a pane starts working. When the turn ends, the `after-agent-state` hook delivers the reply and the row becomes unread.

`TUIOS_AGENT_MESSAGE` holds only the first line of the reply, cut to about 120 characters. The hook therefore reads the whole turn from the Claude Code or oh-my-pi transcript (`source: transcript`) or from a protocol pane's own transcript (`source: pane`). Any other harness gets the one-line summary (`source: summary`). The hook runs after `notifications.agent.settle_seconds` (2 by default), and TUIOS drops it if the pane starts another turn first; that row then stays without a reply.

```js
turn: { id, session, pane_id, pane_name, harness, prompt, response, source, state, unread, archived, task_id, started, finished }
```

## Working with a task

1. Create a task with an existing project directory. Optionally associate an existing worktree directory. The app never creates worktrees.
2. Open an agent or shell from the task. Its TUIOS session is created on demand. Several agents in the task share a session so they can exchange mail.
3. Compose a prompt or shell command with a subject. Close the page or switch tasks while it runs.
4. Read the result in Inbox. Reply to continue in the same pane and thread. Archive or mark threads unread independently of TUIOS's ephemeral read state.
5. Use Inspect for a terminal snapshot, interruption, and shell keys. The inspector shows the `tuios attach SESSION` command for full interactive access.

Agent profiles configure executable, argv, protocol, and environment. Executable Browse opens the backend host's native macOS file chooser; typing a command resolved through PATH remains valid. Project and existing-worktree Browse controls use the native directory chooser. Canceling either picker preserves the current input. Pickers choose the backend filesystem, not the browser device's filesystem. Put model and reasoning options in argv using your harness's actual CLI flags. Codex app-server and OpenCode ACP profiles use TUIOS's structured terminal adapters. Claude Code and oh-my-pi profiles use their native terminal interfaces. Credentials are inherited from the backend's environment and harness settings. Environment overrides are stored in the local database; prefer inherited credentials.

Task status and notes are editable. The project and optional worktree paths identify the working directories. Panes and conversation metadata belong to the task; terminal lifecycle is independent of the browser lifecycle. Closing the web backend does not terminate TUIOS's panes. On restart, an interrupted dispatch is marked uncertain and is never automatically replayed.

## Agent mail

Send mail from the task's session controls, or let agents use the installed `tuios-inbox` skill:

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

Agents receive read/write/fan grants, not respond/admin. This app does not weaken `respond_from_shell` or manufacture a human nonce.

### Questions and approvals in the browser

When an agent's turn is on `needs_input`, opening its row reads the prompt from the pane with `tuios peek-prompt` and shows it: the lines on the pane's screen, the numbered options, and the answers TUIOS can press. The prompt is read when the row opens, after an answer, and from **Read again**, never on a timer. It is the pane's screen, so it is untrusted text.

An answer is sent with `tuios respond --prompt-id`, naming the prompt the page showed. If the pane shows a different prompt by then, TUIOS presses nothing and the page reads the prompt again.

TUIOS takes an answer only from the person, so answering is off until you allow it. Give the pane that runs this server the `respond` grant, from a shell outside TUIOS:

```sh
tuios set-pane-grants -s SESSION -w SERVER_PANE --grants admin,respond
```

A server started outside TUIOS needs `respond_from_shell = true` under `[daemon]` instead. Until then the question is still shown, and an answer is refused with this instruction.

That grant lets this server answer any pane's prompt, and the server accepts requests from any process on this machine that can reach its loopback port. Give it only if that is acceptable. TUIOS still refuses to approve a prompt that matched a risk rule, and approvals held for the TUIOS Inbox are not answerable here; both stay in an attached TUIOS client.

## Capture and durability

The app stores tasks, profiles, pane associations, threads, messages, imported events, and the subscription cursor in `~/.local/share/tuios-inbox/inbox.sqlite`. SQLite uses WAL. The directory is private and the main database and hook files are mode 0600. Do not commit the database.

There are two input paths:

- App-dispatched commands use `tuios run` with OSC 133 command boundaries and preserve output, exit status, and duration. Managed zsh panes load `scripts/shell.zsh` without changing personal shell startup files.
- Agent prompts use `tuios ask-agent` and wait for state completion rather than a two-second silence. Returned text is **captured terminal turn output**, not a canonical final-answer object. It can include prompt echoes, tool activity, wrapping, and terminal decorations. The app labels this `captured`; timeout, idle fallback, or truncation is `partial`. Agent captures are capped at 10,000 lines.

TUIOS does not provide a universal full-answer export across all harnesses. Hook captures are snapshots capped at 2,000 lines, and cannot reconstruct overwritten or missing output. Their provenance stays in Delivery details. A delayed hook's capture may reflect a pane that has already advanced.

The subscriber saves agent mail without marking it read in TUIOS, tracks pane state, and resumes from `(boot_id, seq)`. A replay gap becomes a visible inbox message and triggers state/mail reconciliation. Mail that TUIOS evicted before the app read it cannot be recovered. TUIOS's mailbox is bounded and disappears on daemon shutdown; the app's imported copy survives.

The hook collector writes atomic JSON files to `~/.local/share/tuios-inbox/events`, even while the web backend is stopped. The backend imports them transactionally and removes only consumed files. Completion identities prevent an app result and its matching hook from creating two result messages. An offline completion can recover a pending message from the same daemon boot. App restarts never resend an uncertain prompt.

Background UI updates refresh the list and an unfocused thread. They do not recreate focused task metadata editors or overwrite focused composer and reply drafts.

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
h tuios setup-status
h tuios integrations-status
h tuios doctor
h tuios help                 # full command list
```

`h tuios skills-refresh` regenerates the complete reference from **`tuios --skill all`** under `~/.local/share/h-tuios/skills/tuios-inbox`. The saved copy is named `tuios-inbox`, leaving the name `tuios` to the skill TUIOS itself installs. It links each supported local skill root's `skills/tuios-inbox` there and removes this tool's earlier `skills/tuios` links without overwriting unrelated skills. `bun run refresh-skills` delegates to that command; the web backend is not needed.

`bootstrap-install` adds a marked block to supported global instruction files. It tells newly started agents to inspect their TUIOS environment, read the native core and mail skills, and check their own unread mail at turn start and before finishing. Existing instruction text, symlinks, and hardlinks are preserved; first edits save `.h-tuios.bak` backups. `bootstrap-remove` removes only the marked block. `uninstall` also removes this tool's skill links, but leaves native state hooks and the shared reference intact.

`targets` prints destinations and identifies harnesses needing manual startup rules; `instructions` prints the rule text. `bootstrap` prints pane identity and live core/mail skills inside TUIOS and is silent outside it. `mail` reads only the session/pane supplied by TUIOS's environment and refuses to fall back to the focused pane.

For this installed Cursor CLI, use `h tuios bootstrap-project /path/to/project`; `--remove` removes that project's managed block. Its older build does not support a global `sessionStart` context hook. Hermes setup edits only an existing `SOUL.md`, avoiding replacement of its default persona; the current Hermes launcher points to a missing executable. Gemini's configuration exists but its executable is not on PATH. These limitations are distinct from native hook installation status.

OpenCode keeps its existing Claude global fallback, and omp keeps its existing shared `.agents/AGENTS.md` fallback rather than creating native files that hide inherited rules. Custom provider/profile settings can change which instructions a harness loads.

Restart agent sessions after changing global instructions. These are model instructions, not an idle-agent scheduler or a guarantee that every model obeys them. No daemon restart, automatic reply loop, approval bypass, or MCP permission change is performed. Path overrides supported by the native harnesses are honored where mapped; with `PI_CODING_AGENT_DIR` set, select Pi or omp explicitly rather than installing both into the same directory.

The native installer preserves unrelated settings and writes `.tuios.bak` backups. This machine's current integrations are Claude Code, Codex, Gemini CLI, OpenCode, Antigravity, Cursor Agent, Grok, Hermes, Pi, and oh-my-pi. Antigravity, Grok, and Hermes report conversation identity; their state detection relies on screen rules. Unsupported or never-run harnesses are not fabricated as installed.

## Architecture choice

The standalone app leaves Portfolio unchanged. Its Wails app demonstrates a loopback Bun sidecar, but its PTY ownership closes processes with UI teardown. tuios inbox instead keeps TUIOS responsible for persistent execution and SQLite responsible for tasks and correspondence.

A hook-only collector survives backend downtime but cannot provide live control or complete lifecycle reconciliation. A subscription-only collector provides replay and immediate state but loses unrecoverable events and output during outages. tuios inbox combines resumable subscription and an atomic hook spool. Neither path is presented as a complete harness transcript.

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

## Task-first design comparisons

The merged Task workbench and three original interactive sample-data comparisons live separately from the app. They share Task > Agent > Thread > Turn navigation and an in-memory workspace. They do not open SQLite, call production APIs, or start TUIOS agents.

```sh
bun .impeccable/prototypes/list-directions/server.mjs
```

Open the explicit entry filename, using the port printed by the preview server:

- [A · Task ledger](http://127.0.0.1:4401/task-first/index.html?variant=ledger): a connected task hierarchy beside the review queue.
- [B · Task rooms](http://127.0.0.1:4401/task-first/index.html?variant=rooms): fixed task rooms above a chronological review tray.
- [C · Review desk](http://127.0.0.1:4401/task-first/index.html?variant=desk): a persistent activity index above a focused reading desk.
- [D · Task workbench](http://127.0.0.1:4401/task-first/index.html?variant=workbench): the merged design, with a narrow Task > Agent rail, Rooms graphite palette, compact main content, and a separate sortable review queue.

Opening a response leaves it pending. **Reviewed · next** or a successful sample reply clears only that turn. Variant changes retain selections, review decisions, ordering, and target-specific drafts; reload resets the sample. Expand **Sample controls** to finish working turns deterministically, simulate one failed send, inspect state, or reset. All prompts and results are synthetic. If port 4401 is occupied, run the same command with `PORT=4402` or another free port; do not stop the existing process.

Agent execution state is carried by the whole agent row: green Working, amber Needs input, rose Stopped, flat neutral Idle, and subdued dashed Offline. Borders and offset soft shadows strengthen for states needing attention; labels and glyphs remain visible. These treatments do not change task-level counts or whether a response awaits review.

The entry without a variant opens the merged workbench. Its desktop task rail is 15% wide, bounded to 200–250px; only tasks and agents appear there. Threads and turns open in the main pane, and reviewing displays the original prompt with its response. On narrow screens, Tasks is expandable and the queue opens separately. Content navigation writes real URL/history entries: browser Back/Forward restores the previous view without rolling back drafts, sent prompts, or review decisions. The `task`, `agent`, `thread`, and `turn` query parameters deep-link sample records; reloading still resets sample mutations and drafts.

Merged screenshots: [desktop](.impeccable/review/task-first/workbench-desktop.png), [open response](.impeccable/review/task-first/workbench-response.png), and [mobile](.impeccable/review/task-first/workbench-mobile.png).

These previews remain isolated sample-data comparisons. The default live app now uses the merged workbench design with its existing production APIs and records; it does not import the sample model.
