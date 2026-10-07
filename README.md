# tuios inbox

Local task management and an email-style inbox backed by TUIOS. Browser UI, Bun HTTP server, SQLite. No package install or frontend build is required.

```sh
cd ~/proj/tuios-inbox
bun start
```

Open http://127.0.0.1:4399. The server binds only to loopback and rejects foreign origins, foreign Host headers, and mutations without its same-origin JSON header. Do not expose it through a public proxy. It can execute commands as your user.

For port 4401, run `PORT=4401 bun start`. This serves the actual application with the Flight deck layout; the historical visual comparison under `.impeccable/prototypes/` is not part of the app and has no real task actions.

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

The default page is the live Flight deck inbox: a dark blue workspace with a left navigation rail, condensed headings, amber actions, and searchable work records. It uses the real SQLite/TUIOS data and APIs, not sample data. **Task groups**, **Work**, and **Review** switch the main work area; task groups list the agents and shell panes assigned to each task. **Not assigned to a task** contains recipients outside the visible task groups. Task and agent pages show their scoped history.

Unread records have a lighter blue background, a bold title, and an explicit **Unread** label with a dot. Read records have a darker background, normal-weight title, and **Read** label. Checking a record adds an outline without replacing its read-state styling.

Checkboxes and **Select all** are available in the Inbox, task and agent histories, the review queue, task member lists, task groups, and all indexes. Selecting work records reveals **Mark as read**, **Mark as unread**, and **Archive**. Use **Restore to inbox** in Archive to bring records back. Selection is separate for each list, survives live updates, and clears from history and members when the route changes. Failed writes retain the selection and show an error; pending actions disable their controls.

Task and agent rail selections can be archived independently. This hides those entries without stopping panes or archiving their work. Task member lists also support unarchiving agents. The Tasks and Agents indexes retain their status, assignment, archive, and unarchive actions; Agent profiles supports bulk deletion with confirmation.

The review queue contains unread, unarchived finished responses, oldest first by default. Shell command output is bucketed apart and hidden until **Show commands** is ticked. Opening a record marks it read; **Mark as unread** puts it back. **Next** moves to the following record. A successful reply also clears the record. The **Queues** page shows the same unread work as one queue per task, oldest at the top, with a reading pane beside it.

Inbox, Queues, Prompts, Tasks, TUIOS, Agents, Archive, and Agent profiles are available in the left navigation. Work indexes retain shared search, filters (`is`, `is not`, `has`, `has no`), sort, multi-select, and bulk actions. Opening a work record navigates to its main-pane detail. Task and Agent pages contain factual, editable metadata and scoped history; scope uses Task IDs or native Agent/pane IDs, not display names or removable filter chips. On narrow screens, the bottom Task groups, Work, and Review buttons switch between work areas; Queues has its own reading pane.

All is the default type selection and exclusive reset. Turns and Commands toggle independently; selecting both includes either type. The type union combines with search, filters, and sort. Selecting neither returns to All. Read and unread backgrounds describe state, never alternating stripes.

Expand **Send work to an agent or pane** to use the inline composer. It sends a prompt or shell command to a native recipient and keeps its draft and expanded state during live updates. It lists Agents once and only agentless Panes separately, deduplicated by native ID. Task, Agent, and Pane selectors offer matching New choices. Creation returns the real record to the initiating selector; cancel or failure preserves its selection context and typed draft. Agent selection waits for that startup thread and returned native pane to become ready. Failed or blocked startup is not presented as ready.

On the Agents page, assign a pane to a task. Its existing turns and commands move to that task, unless you moved one elsewhere by hand, and new ones inherit it.

Execution-host labels appear in task groups, task members, agent/pane rows and details, work records, review rows, and recipient selectors. They use native TUIOS host names such as **local** or **build**. Unknown historical hosts show **Not reported**; missing hook metadata never overwrites a known host. Detailed native pane listings resolve hosts during reconciliation and for newly observed recipients. A task can contain recipients on multiple hosts; this adds labels, not a host-management interface.

```js
item:  { id: 'turn:…' | 'thread:…', type: 'turn' | 'command' | 'mail' | 'system' | 'dispatch' | 'snapshot',
         title, agent_id, agent_name, harness, task_id, status, unread, archived, response_captured, created, updated }
agent: { id, session, name, harness, host: 'local' | 'build' | '', kind: 'agent' | 'shell', task_id, state, seen }
```

## Prompts and turns

Choose **Prompts** in the left navigation to see agent turns without command records. The route remains `#turns`. Every turn detail has an explicit **PROMPT** section with the full captured text, even while the agent works or waits for input. A completed turn also has a **RESPONSE** section.

Record headers and table titles occupy one line with an ellipsis when needed. The body retains the entire prompt and completed response. Both render as Markdown, including headings, emphasis, lists, code blocks, and tables.

A turn row opens when a pane starts working. Native metadata or the capture hook supplies its prompt without waiting for a final reply. Reconciliation recovers missing prompts for still-active panes from supported transcripts. Known prompts remain unchanged as later hook reports arrive. When the turn ends, the hook supplies the response and the row becomes unread. If no reliable prompt source exists, the detail states that no prompt text was captured.

Turns with both a blank prompt and a blank response are automatically archived, including pending empty rows. Whitespace-only text counts as blank. The records remain in SQLite and Archive. A later captured prompt or response restores the same automatically archived record. Explicit manual archives stay archived. Prompt-only and response-only turns remain visible.

The item field `response_captured` changes when a stored response arrives. Open details use it to refresh delayed responses even when the native completion timestamp does not change, while preserving reply drafts.

`TUIOS_AGENT_MESSAGE` holds only the first line of the reply, cut to about 120 characters. The hook therefore reads the whole turn from the Claude Code or oh-my-pi transcript (`source: transcript`) or from a protocol pane's own transcript (`source: pane`). Any other harness gets the one-line summary (`source: summary`). The hook runs after `notifications.agent.settle_seconds` (2 by default), and TUIOS drops it if the pane starts another turn first; that row then stays without a reply.

```js
turn: { id, session, pane_id, pane_name, harness, prompt, response, source, state, unread, archived, auto_archived, task_id, started, finished }
```

## TUIOS management

Choose **TUIOS** to browse native sessions, numbered workspaces, and windows. Each window is one terminal pane. An agent is state and harness metadata on that same pane UUID, not another movable child. The hierarchy includes native panes created outside Inbox.

Choose **Overview** (`#tuios-overview`) for a visual inventory of all live sessions. Each session contains workspace cards, with pane tiles showing name, execution state, harness, host, and task assignment. Tiles show membership, not the native terminal layout. **Sessions** retains the detailed table browser.

Use **Inspect** to open a pane’s native details and snapshot. Use **Move pane** to choose any workspace in the same session, or drag a tile onto a workspace card. **Show empty workspaces** reveals empty destinations. Cross-session drops and same-workspace drops send no mutation. Moves retain the native pane UUID and do not change task assignment or future task homes.

**Filter panes** expands search, host, and state controls without crowding the overview. Filters and the empty-workspace preference survive navigation and live reads. The overview reads session metadata, not every pane’s terminal capture. Native updates wait during an active drag, then refresh after it ends. Unavailable sessions and failed reads remain explicit.

Session and pane tables have Name, Host, State, and Actions columns, with search and host/state filters. Pane details show full native metadata, agent state, bounded activity, and a 200-line terminal snapshot. **Read again** refreshes native state. Browsing never selects a terminal workspace or changes terminal focus. **Select in terminal** and **Focus in terminal** are explicit actions.

Create sessions and panes, label or rename sessions, set session accents, name workspaces, rename panes, move panes between workspaces in the same session, and minimize or restore panes. Splits require an attached terminal client with tiling enabled and can change terminal focus. Session layout controls affect the terminal-selected workspace, not the browsed workspace. Native cross-session pane transfer is unavailable. Session rename and kill are local-only.

Closing a pane, closing a workspace, killing a session, or interrupting a process requires a confirmation checkbox and explicit submit. Task records and captured history remain stored after native closure. Agent launches use saved profiles and expose the actual startup thread. Queued prompts require native agent metadata and never execute as shell commands. Native grants and human approvals remain enforced.

Use one session per task by default. For a shared project session, use **Bind future task home** on the desired session or workspace:

```js
{ title: "Auth", session: "auth", workspace: null } // Session default
{ title: "Auth", session: "project", workspace: 2 } // Shared session, workspace 2
```

A task home places future shell and agent launches. Changing that home never moves existing panes or rewrites history. Existing controls, capture, and mail use each pane’s execution session. **Assign pane to task** changes work grouping independently of native placement, preserving individually reassigned records. Managed mail requires recipients in the same execution session.

Working-directory **Browse** opens the backend host’s native directory chooser for local launches. Remote launches inherit native directory defaults and reject local picker paths. Host configuration remains in TUIOS. Remote managed shells do not source the backend’s local shell integration script; command-marking availability is checked by native TUIOS.

## Working with a task

1. Create a task with an existing project directory. Optionally associate an existing worktree directory. The app never creates worktrees.
2. Open an agent or shell from the task. Its dedicated TUIOS session is created on demand by default. An explicit future task home can use an existing session or numbered workspace instead.
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

## Terminal task workspace

`tuios-inbox-tui` is an optional terminal front end for the same tasks and the same SQLite data, reached through this server's HTTP API. It is an independent Go module (`go.mod` at the repository root) and shares no code with TUIOS. `bun start` and `bun test` never build it.

```sh
bun run build:tui        # go build -o bin/tuios-inbox-tui ./cmd/tuios-inbox-tui
bun run install:tui      # go install, into $(go env GOBIN) or ~/go/bin
bin/tuios-inbox-tui --help
```

Options: `--url` (default `$TUIOS_INBOX_URL`, then `http://127.0.0.1:4399`), `--client` (default `$TUIOS_CLIENT_ID`) and `--tuios-bin` (default `$TUIOS_BIN`, then `tuios`). Tasks are on the left and the selected task's live windows on the right; on a narrow terminal one column fills the screen and Tab switches. Keys: arrows or `j`/`k`, Tab, Enter, `n` task, `w` window, `s` session, `r` refresh, `/` find, Ctrl+N new task, Esc back or close. The mouse works too. On a very short screen (under 12 rows) rules, descriptions, buttons and the info line are dropped so the Name field, selected task, and status or error line stay visible; the keys still work. Esc from the task chooser or from inline task creation, when either was opened from a window or session form, returns to that form with its typed name, selected task, filter, cursors, scroll and pane focus exactly as they were, even if the selected task has since become unavailable (submitting it is still refused). Choosing or creating a task is the only way to change the form's task. When Ctrl+N or `n` starts the mandatory first-task creation straight from the list, Esc returns to the list and creates nothing. Jumping waits up to 50 seconds for `tuios jump-window` to confirm; a timeout is shown as an error, never as success. State is held in memory only.

Enter on a window runs `tuios jump-window --client CLIENT --session HOST:SESSION WINDOW_UUID` and exits only after TUIOS confirms the jump; a failure is shown and the app stays open. Jumping needs the client that launched the popup, so outside a popup (no `--client`) listing and creating still work and jumping reports that. Core TUIOS has only generic popups; bind the program in `config.toml`:

```toml
[popups.tasks]
command = ["/Users/you/proj/tuios-inbox/bin/tuios-inbox-tui", "--url", "http://127.0.0.1:4399"]
width = "90%"
height = "85%"

[keybindings.prefix_mode]
"popup:tasks" = ["g"]
```

This binding requires a TUIOS build with generic configured popups and `jump-window`, and a daemon and attached clients running that build. Updating only the CLI binary does not update a running daemon. If the desired `tuios` is not on the daemon's PATH, include `"--tuios-bin", "/absolute/path/to/tuios"` in `command`. The binding is configuration, not a built-in task shortcut.

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

Opening a response marks it read; **Mark as unread** restores it, and **Next** moves on. A successful sample reply clears only that turn. Variant changes retain selections, review decisions, ordering, and target-specific drafts; reload resets the sample. Expand **Sample controls** to finish working turns deterministically, simulate one failed send, inspect state, or reset. All prompts and results are synthetic. If port 4401 is occupied, run the same command with `PORT=4402` or another free port; do not stop the existing process.

Agent execution state is carried by the whole agent row: green Working, amber Needs input, rose Stopped, flat neutral Idle, and subdued dashed Offline. Borders and offset soft shadows strengthen for states needing attention; labels and glyphs remain visible. These treatments do not change task-level counts or whether a response awaits review.

The entry without a variant opens the merged workbench. Its desktop task rail is 15% wide, bounded to 200–250px; only tasks and agents appear there. Threads and turns open in the main pane, and reviewing displays the original prompt with its response. On narrow screens, Tasks is expandable and the queue opens separately. Content navigation writes real URL/history entries: browser Back/Forward restores the previous view without rolling back drafts, sent prompts, or review decisions. The `task`, `agent`, `thread`, and `turn` query parameters deep-link sample records; reloading still resets sample mutations and drafts.

Merged screenshots: [desktop](.impeccable/review/task-first/workbench-desktop.png), [open response](.impeccable/review/task-first/workbench-response.png), and [mobile](.impeccable/review/task-first/workbench-mobile.png).

These previews remain isolated sample-data comparisons. The default live app now uses the merged workbench design with its existing production APIs and records; it does not import the sample model.
