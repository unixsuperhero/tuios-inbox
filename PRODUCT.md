# tuios inbox

<!-- impeccable:product-schema 1 -->

## Platform

web

The current interface runs in a browser. A Wails or Electron desktop shell is a later concern; neither framework has been selected.

## Users

The primary user is the owner, managing coding agents and shell work on their own machine. Browser access from other devices on their Tailscale tailnet is required.

## Product purpose

Give the user one browser workspace for asynchronous agent work. Two jobs are equally important:

- Review agent turns across TUIOS sessions without visiting each terminal pane.
- Dispatch project-scoped work, leave while it runs, then review results and continue the conversation.

Success means the user can understand completed work, respond to questions, handle human approvals, and continue work from the browser. Routine operation must not require switching to a terminal.

## Positioning

TUIOS owns persistent execution in terminal panes. tuios inbox presents that work as a cross-session Turns feed and project-scoped tasks with threaded correspondence. SQLite stores the app's task and conversation records independently of the browser lifecycle.

## Operating context

- The current stack is plain HTML, CSS, and browser JavaScript, with a Bun HTTP server and SQLite. The backend integrates with a local TUIOS daemon and installed agent harnesses.
- Tasks refer to existing project directories and, optionally, existing worktree directories. The app does not create worktrees.
- Work can continue after the browser closes. Turns and correspondence let the user return to review and respond later.
- Current execution and capture-hook setup are macOS-oriented. That is implementation context, not a confirmed permanent platform restriction.
- The intended access boundary includes the user's Tailscale tailnet. Loopback-only access is not the product goal, and tailnet access does not imply public-internet exposure.

## Capabilities and constraints

### Required product behavior

- Keep the product name **tuios inbox**.
- Treat cross-session Turns review and task-centered dispatch and correspondence as equal core workflows.
- Support browser access across the user's Tailscale tailnet.
- Put routine operations and human approvals in the browser. Require terminal access only when it is absolutely unavoidable.
- Every UI input for a local filesystem path must provide a real OS file or directory picker. Match the picker to files or folders and support single or multiple selection as required. Use a save dialog for a new output file. Manual path entry may accompany the picker, never replace it.
- Browser approval must represent a real authorized human action. Agent messages and shell-origin requests are not equivalent to human authorization. Tailnet and browser-approval work must preserve that distinction rather than bypass it.

### Current implementation gaps

These are limitations of the current implementation, not accepted product requirements:

- The backend binds to loopback and restricts Host and Origin headers. Tailnet browser access is not currently provided by this configuration.
- Human approvals and other human-only operations currently require an attached TUIOS client. This falls short of the browser-first requirement.
- Executable Browse now opens a native macOS file chooser, while typed PATH commands remain valid. Project and worktree Browse controls use the native directory chooser. Both pickers select the backend host's filesystem, not the browser device's filesystem. Path selection for remote browser use remains a product-design decision.

These remaining gaps are not resolved by the current UI changes.

### Existing execution and capture boundaries

- Terminal panes belong to TUIOS and persist independently of the browser and web backend.
- Captured output has different sources and can be partial, truncated, or unavailable. Preserve provenance and uncertainty instead of presenting every capture as a complete final answer.
- An interrupted dispatch is uncertain and is not automatically replayed on app restart.
- Imported correspondence persists in the app, but TUIOS's native mailbox is bounded and transient. Do not promise recovery of output or mail that was never captured.

### Open decisions

- The access-control and trusted-human authorization mechanisms for tailnet browser access and browser approvals are not selected.
- Wails versus Electron, desktop-shell scope, and timing remain undecided. The current platform stays web until that work is requested.
- No broader audience, commercial positioning, or permanent macOS-only restriction has been confirmed.

## Brand commitments

The confirmed name is **tuios inbox**, now shown in the interface and README. No visual direction was chosen during initialization. The subsequent Packet capture workbench implementation is recorded in [DESIGN.md](DESIGN.md).

## Evidence on hand

- [README](README.md) describes current workflows, capture limitations, setup, and security restrictions. Its native-client approval flow remains a current limitation, not the confirmed browser-first product direction.
- [Server](server.mjs) implements the Bun backend, SQLite records, TUIOS integration, loopback binding, and request restrictions.
- [Browser interface](public/index.html) and [browser behavior](public/app.js) provide the existing UI and workflows.
- [Capture hook](scripts/capture-hook.mjs) and [turn capture](scripts/turn.mjs) provide native event collection and capture provenance.

## Product principles

- Make the browser sufficient for everyday work, including human approvals. Terminal access is an exception.
- Support the user's actual access context, including their Tailscale tailnet, without treating network reachability as human authorization.
- Give Turns review and task dispatch equal importance. The user should not need to monitor every live terminal session.
- Preserve work and conversation state while the user leaves and returns. Show capture uncertainty honestly.
- Use OS file and folder selection wherever the user must supply a local path.
