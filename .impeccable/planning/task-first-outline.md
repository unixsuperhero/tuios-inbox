# Task-focused outline design brief

Mode: Operate. The user approved inline task planning on 2026-10-12. This brief replaces the earlier mixed task/prompt/run outline proposal and its synthetic-mock scope. [task-focus-api.md](task-focus-api.md) is the authoritative implementation contract. Preserve the Flight deck design recorded in [DESIGN.md](../../DESIGN.md).

## Job and audience

The owner plans coding work across native TUIOS sessions, mainly from a desktop browser and sometimes from a phone. Tasks answers "what do I do next?" Queue answers "what finished or needs my attention?" The two jobs remain equally important without sharing a mixed navigation tree.

## Tasks is the planning page

Tasks is the default page. Its main outline and task navigation contain tasks and subtasks, not agents, terminal panes, prompts, responses, or documents as peer tree nodes. Keep completed tasks available under a disclosure rather than filling the initial view.

Expand a task inline to write a next step, add a subtask, compose a multiline prompt, or adjust settings. Prompt creation does not require a special `>` prefix or a creation dialog. Saving a prompt and running it are distinct actions. Preserve saved text, unsuccessful dispatch text, and edits made during an in-flight request.

Tasks uses `#outline/tasks`; bare `#outline` resolves to Tasks. Inline controls distinguish Add subtask, Save prompt, and Run. Existing `j`/`k` navigation, Enter expansion, `n` task creation, and Cmd/Ctrl+Enter dispatch/reply remain available. Completed ancestors with open descendants stay visible.

Saved or dispatched text stays visible in its inline receipt until an explicit New prompt action starts the next draft. Native errors stay in the receipt with retry/settings controls. The advanced Everything view is `#outline/everything` under Activity.

Settings use progressive disclosure. Show the effective working directory, harness, model, and launch mode beside dispatch so the user can see what will run. Task status, hierarchy, reparenting, deletion, notes, archive behavior, and explicit native inspection remain available.

## Queue is the aftermath page

Queue leads with results, questions, failures, and work awaiting review. Task creation does not occupy its primary layout. The reader retains the full prompt, captured response, documents, provenance, capture uncertainty, question and approval handling, and replies that continue in the original pane.

A result grouped under a parent still uses its actual leaf task's identity. A reply preserves the original prompt's ownership, including an intentional No task assignment. Do not infer task ownership from display names or recolor historical results as the selected parent.

Advanced activity and native views stay reachable. Existing captures are not dropped or silently renamed to fit the new planning layout.

## Execution inheritance

An unset execution field resolves through the task hierarchy. Children inherit directory configuration, branch, harness, model, queue mode, launch mode, and native session/workspace unless they override those fields. Show the value's source where available; do not copy inherited values into children.

The effective working directory comes from the nearest task record that sets either a project directory or an existing worktree. Prefer the worktree on that same record. A child with its own project must not run in an unrelated ancestor's worktree. Session and workspace resolve independently, so a child's workspace override remains effective when its session comes from an ancestor.

Untargeted prompts default to a new background agent. Reuse is an explicit inheritable option and uses only a known compatible idle app-launched agent with matching directory, profile, and model. If none exists, launch a new agent. An explicit pane target means continuation, not a new launch. Changing a task's future launch home never relocates existing panes or rewrites their execution address.

The app uses existing directories and worktrees. It does not create or switch branches or worktrees. Git and pull-request facts describe the effective directory; they are not permission to change it.

## Independent task identity

Each task and subtask receives its own immutable, server-assigned positive unique seed, including archived tasks and imported OMP subtasks. Appearance is never inherited. Restart, rename, reparent, completion, repeated import, and reset preserve the seed. Deleting a task does not make its seed available to a later task.

Automatic identity combines a muted generated color with an authored icon. The user can override the named theme, icon, or custom hex color independently, including through a native color input. Missing patch fields preserve existing choices; empty strings clear individual overrides. Reset clears all appearance overrides and restores the original automatic assignment. Matching overrides are allowed.

Unique numeric seeds do not promise unlimited perceptual uniqueness. Icons repeat and nearby colors can look similar; the visible task label remains necessary. Unknown and unassigned tasks render neutrally.

The same identity appears on task navigation, inline planning, prompts, replies, responses, Queue, and retained history/activity views. Task colors are a narrow exception to Flight deck's shared palette, confined to the task mark, subdued wash, and one-pixel identity rule. They do not replace amber actions, keyboard focus, read/unread treatment, selection, or status text.

## Warnings preserve user control

Advisory execution checks name the concern and offer an explicit Proceed anyway action. They must not permanently disable dispatch for missing defaults, unfamiliar harness/model names, dirty work, branch mismatch, or busy/unknown/mismatched pane state. The API override is `allow_warnings: true`.

Without a configured directory, explain the home-directory fallback before the user proceeds. Without a saved harness profile, explain that proceeding runs the chosen executable without extra profile arguments. Format errors remain errors and retain the user's edits for correction.

A busy pane or a pane answering its own question uses TUIOS's native queue through Queue anyway. Queuing waits rather than typing an accidental approval. Never send raw keys or treat a queued prompt as trusted-human approval. Native authorization remains authoritative.

Report missing executables, gone targets, permission refusals, and failed launches as actual execution errors, with recovery or another-target controls. An accepted or queued request is not completed work. An interrupted dispatch is uncertain and is not automatically replayed after restart.

There are no arbitrary task-title or prompt-editor length caps. Warn about native transport limits, including TUIOS's documented 16 KiB queue-message ceiling, while allowing the user to save and explicitly attempt the prompt. Report any actual native refusal. Never silently truncate or split the prompt.

Manual queues run through explicit actions. Automatic queues retain ordering and stop for findings that need user confirmation or actual dispatch failure rather than silently approving warnings or skipping dependent work. No task remains manual.

## Interaction and preservation

Use existing keyed DOM updates and SSE notifications. Preserve input focus, drafts, scrolling, open disclosures, and selection across updates; add no refresh timer. Retain compatible keyboard shortcuts, visible labels, native controls, and mobile touch targets.

Every local path input retains the actual OS Browse picker alongside manual entry. Project and existing-worktree inputs open a directory picker; executable inputs open a file picker. Cancel preserves the input. These pickers select the backend host's filesystem, not the browser device's filesystem.

Capture provenance and uncertainty remain visible. Partial, truncated, summary-only, and missing responses are not presented as complete answers. Native execution survives browser closure independently of app records.

## Verification boundary

This brief records accepted behavior, not a successful test run. The parent owns final integrated native and desktop/mobile verification. Fixtures must use isolated app storage and native sessions, never the user's live task data. Do not restart the native daemon, use worktrees for this implementation, or run repeated screenshot-polish loops.

Tailnet access and complete browser human-approval authorization remain the product gaps recorded in [PRODUCT.md](../../PRODUCT.md). This planning change does not claim to resolve them.
