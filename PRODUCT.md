# tuios inbox

<!-- impeccable:product-schema 1 -->

## Platform

web

The current interface runs in a browser. A Wails or Electron desktop shell is a later concern; neither framework has been selected.

## Users

The primary user is the owner, managing coding agents and shell work on their own machine. Browser access from other devices on their Tailscale tailnet is required.

## Product purpose

Give the user one browser workspace for asynchronous agent work. Tasks is the default planning page; Queue is the aftermath and result-review page. Both jobs are core workflows.

- Write tasks, subtasks, next steps, and prompts inline without navigating a pane/turn/document tree.
- Review captured results, questions, failures, documents, and continued replies without visiting each terminal pane.

Success means the user can plan work, dispatch it, return to review results, respond to questions, handle human approvals, and continue work from the browser. Routine operation must not require switching to a terminal.

## Positioning

TUIOS owns persistent execution in terminal panes. tuios inbox presents task-focused planning and a separate Queue for review and correspondence. SQLite stores task and conversation records independently of the browser lifecycle. An optional standalone terminal task workspace (`tuios-inbox-tui`) uses the same HTTP API and records; it supplements the browser and is not required for routine work.

## Operating context

- The current stack is plain HTML, CSS, and browser JavaScript, with a Bun HTTP server and SQLite. The backend integrates with a local TUIOS daemon and installed agent harnesses.
- Tasks refer to existing project directories and, optionally, existing worktree directories. The app does not create worktrees.
- Work can continue after the browser closes. Turns and correspondence let the user return to review and respond later.
- Current execution and capture-hook setup are macOS-oriented. That is implementation context, not a confirmed permanent platform restriction.
- The intended access boundary includes the user's Tailscale tailnet. Loopback-only access is not the product goal, and tailnet access does not imply public-internet exposure.

## Capabilities and constraints

### Required product behavior

- Keep the product name **tuios inbox**.
- Treat inline Tasks planning and Queue review/continuation as equal core workflows. Keep advanced activity and native views reachable.
- Let tasks and subtasks inherit execution settings while keeping each task's persistent theme/icon/custom-color identity independent. Carry that identity to every owned prompt and response without using color as the only label.
- Keep the server-assigned task seed stable across restart, rename, reparent, completion, and reset. Theme, icon, and custom-color overrides reset independently without changing the seed. Unique numeric seeds do not promise unlimited perceptual uniqueness, and matching user overrides are allowed.
- Default untargeted prompts to fresh background execution. Resolve cwd from the nearest task with a project or existing worktree, preferring that record's worktree; do not borrow an unrelated ancestor worktree.
- Warn about advisory execution concerns and offer explicit Proceed anyway. Use native Queue anyway for busy/question targets, never raw-key approval injection. `allow_warnings` does not bypass native authorization.
- Preserve full task titles and prompts without artificial editor caps. Warn about native transport limits and report actual refusals rather than silently truncating or splitting text.
- Preserve drafts, focus, scrolling, and disclosures across existing SSE updates.
- Support browser access across the user's Tailscale tailnet.
- Put routine operations and human approvals in the browser. Require terminal access only when it is absolutely unavoidable.
- Every UI input for a local filesystem path must provide a real OS file or directory picker. Match the picker to files or folders and support single or multiple selection as required. Use a save dialog for a new output file. Manual path entry may accompany the picker, never replace it.
- Browser approval must represent a real authorized human action. Agent messages and shell-origin requests are not equivalent to human authorization. Tailnet and browser-approval work must preserve that distinction rather than bypass it.

### Current implementation gaps

These are limitations of the current implementation, not accepted product requirements:

- The backend binds to loopback and restricts Host and Origin headers. Tailnet browser access is not currently provided by this configuration.
- A blocked agent's question or approval is shown in the browser, and answered there once the user gives the server's pane the TUIOS `respond` grant. Held approvals, risk-matched approvals and other human-only operations still require an attached TUIOS client. This falls short of the browser-first requirement.
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

The confirmed name is **tuios inbox**. The incumbent Flight deck shell is recorded in [DESIGN.md](DESIGN.md). The task-focused redesign preserves its palette, typography, and controls, with a narrow task-identity color exception for marks, subdued washes, and rules. Task identity never replaces status, unread state, selection, or amber actions.

## Evidence on hand

- [README](README.md) describes current workflows, capture limitations, setup, and security restrictions. Its native-client approval flow remains a current limitation, not the confirmed browser-first product direction.
- [Server](server.mjs) implements the Bun backend, SQLite records, TUIOS integration, loopback binding, and request restrictions.
- [Browser interface](public/index.html) and [browser behavior](public/app.js) provide the existing UI and workflows.
- [Capture hook](scripts/capture-hook.mjs) and [turn capture](scripts/turn.mjs) provide native event collection and capture provenance.

## Product principles

- Make the browser sufficient for everyday work, including human approvals. Terminal access is an exception.
- Support the user's actual access context, including their Tailscale tailnet, without treating network reachability as human authorization.
- Give Tasks planning and Queue aftermath equal importance. The user should not need to monitor every live terminal session.
- Leave execution decisions with the user through explicit advisory overrides while reporting native failures truthfully.
- Preserve work and conversation state while the user leaves and returns. Show capture uncertainty honestly.
- Use OS file and folder selection wherever the user must supply a local path.
