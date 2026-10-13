# Task-first outline API reference

This reference covers the retained task, prompt, and run model. [task-focus-api.md](task-focus-api.md) is the authoritative contract for the 2026-10-12 task-focused redesign, warning overrides, identity, and ownership. It supersedes this file's earlier prototype-only scope, mixed navigation, hard preflight blocks, and idle-pane reuse default. See [task-first-outline.md](task-first-outline.md) for the accepted planning and review behavior.

## Persistence

Use the existing SQLite additive-migration convention. Tasks retain project `path` with `repo` as its API alias, optional existing `worktree`, `parent_id`, status, archive state, notes, native home, branch, harness, model, and queue mode. Empty execution overrides inherit.

Tasks add `launch_mode`, immutable server-owned `style_seed`, and independent `style_theme`, `style_icon`, and `style_color` overrides. A task's `style` projection is `{ seed, theme, icon, color }`; automatic override values are `null`. Clients cannot assign seeds. Seeds are assigned and backfilled transactionally, including archived and imported tasks, with a settings highwater that prevents reuse after deletion.

Prompts retain `id`, `body`, `task_id`, optional pane `target`, harness/model overrides, queue position, state, error, and timestamps. They add inheritable `launch_mode`. Prompt states are `queued`, `running`, `blocked`, `done`, and `errored`. A blocked or errored prompt retains its full body.

Turns retain `prompt_id`, capture provenance, full captured prompt/response, execution pane/session, read/archive state, and before/after commit metadata. A turn is presented as a run without replacing native capture semantics.

## Pure execution model

`public/outline-model.js` has no DOM, fetch, or Node imports. The default harness is `omp`, the default queue mode is `manual`, and the default launch mode is `new`.

`resolve(record, tasksById)` returns values and sources through the prompt/task/parent chain. Execution fields include project, branch, harness, model, queue mode, launch mode, session, and workspace. Tasks expose their own worktree setting and a derived `resolved.cwd`.

Resolve cwd from the nearest task record with a project or worktree, preferring that record's worktree. Do not combine a child's project with an ancestor's unrelated worktree. Resolve session and workspace independently. Use effective cwd for launch, preflight, git/commit facts, and launch-context labels.

`preflight` retains named findings and correction hints. Execution configuration and pane-state findings appear in `warns` with a correction hint and require a reachable explicit override, not a permanent user-facing veto. Empty prompt text remains the `no_text` block because there is no message to send. Protocol format errors and actual native authorization/execution failures remain errors. Native queue-size warnings count UTF-8 bytes, not characters, and preserve the full text.

`nextInQueue(prompts, taskId)` selects the lowest-position queued prompt in that task. A null task means No task. The No task queue remains manual.

## HTTP requests and projections

Existing origin, Host, same-origin JSON header, and native authorization requirements remain unchanged. Writes require `x-inbox-request: 1`.

`GET /api/outline` retains `defaults`, `tasks`, `prompts`, `runs`, `panes`, and `profiles`. Task records include own/resolved execution settings, style, git facts, and notes. Prompt records include full stored body, resolved settings, state, error, and preflight findings. Run summaries retain capture/read/archive state and ownership; full captured content comes from `GET /api/turns/:id`.

| Method and path | Request additions and behavior |
|---|---|
| `POST /api/tasks` | Retains title, parent, project, worktree, branch, harness, model, queue mode, and home settings. Accepts launch mode and theme/icon/color overrides, never a client seed. |
| `PATCH /api/tasks/:id` | Missing fields preserve values. Empty appearance strings clear each override independently. Empty execution overrides inherit. `parent_id: null` removes the parent. Validate supplied appearance values before writing any part of a combined patch. |
| `POST /api/prompts` | Retains body, task ownership, pane target, harness/model, and `run`. Accepts launch mode and `allow_warnings`. Saving does not require complete launch configuration. An absent task can inherit the target pane's task; explicit `task_id: null` preserves No task. With `run: true` and unacknowledged warnings, returns 201 with `ran: false`, `preflight`, and the saved prompt in `blocked` state. |
| `PATCH /api/prompts/:id` | Retains body, ownership, target, harness/model, and requeue updates. Accepts launch mode. |
| `DELETE /api/prompts/:id` | Removes the saved prompt through the existing route. |
| `POST /api/prompts/:id/run` | Returns 409 with `warnings: true`, `preflight`, and the preserved prompt until `allow_warnings: true` explicitly acknowledges advice. A successfully accepted attempt returns 202; native failures remain errors, not acceptance or completion. |
| `POST /api/prompts/:id/move` | Retains explicit task assignment and relative queue ordering. |
| `POST /api/tasks/:id/run-next` | Runs the next saved prompt in the task's queue through the same execution rules. Unacknowledged warnings return 409 with `warnings: true`, `preflight`, and `prompt`; explicit `allow_warnings: true` permits an attempt, and native acceptance returns 202. `none` addresses No task. |
| `POST /api/git/refresh` | Returns facts for the task's effective cwd without creating or checking out branches or worktrees. |

No task-title or prompt-body business-policy length cap is imposed by the editor. Saving and explicit attempts retain the whole text. A native queue-message limit can produce a real native refusal; never silently truncate or split text to conceal it.

The existing `/api/state` and history projections add `style_task_id` where needed without changing assignment/filter fields or host-aware provenance. Consumers test property presence, not nullish fallback, because explicit null means No task.

Existing capture, SSE, directory/file picker, question, and answer endpoints remain. SSE causes existing reads rather than a new polling timer.

## Dispatch and native boundaries

Untargeted prompts default to a fresh background agent. Reuse mode can select only a known compatible idle app-launched agent with matching effective cwd, profile, and model; otherwise it launches fresh. Persist launch compatibility metadata. An explicit target continues in that pane's existing execution session.

Missing cwd warns about the home-directory fallback. An unfamiliar harness without a saved profile warns that proceeding runs the user-chosen executable without extra profile arguments. Unfamiliar model names, missing defaults, branch mismatch, dirty work, and unknown/mismatched pane state must not become permanent advisory vetoes.

Busy panes and panes waiting on their own question use the native queue after explicit Queue anyway. Never type raw keys at a question, bypass a held approval, or impersonate a trusted human. `allow_warnings` acknowledges app advice only; it does not grant native permission.

Missing executables, gone panes, native permission refusals, and launch/queue failures remain truthful errors with the prompt preserved. Do not report acceptance as completion or blocked startup as readiness. Native queue acceptance can leave work waiting rather than immediately running.

Replies create a prompt with the original owner and the run's pane target. Preserve intentional No task ownership. Parent-grouped results and older embedded runs resolve their own task rather than the selected parent's task.

Automatic queues retain ordering. They do not automatically acknowledge warnings, answer questions, or skip dependent prompts after failure. Completion links captured turns to prompts through the existing prompt/run association and preserves capture provenance and uncertainty.

Prompt/run association records the actual send timestamp. An empty native startup-idle capture must not claim a newly launched saved prompt before dispatch. Reconciliation ignores or repairs those empty startup associations and links the actual captured run, including after restart.

Git and pull-request facts are read-only, cached, and refreshed through existing reads and explicit refresh. Missing `gh` or failed pull-request lookup means unavailable facts, not fabricated passing checks.

## Shared task identity

`public/task-style.js` exports authored choices, appearance parsing, and a deterministic resolver. Automatic icons use a frozen order. Theme overrides include `sage`; icon overrides include `compass`. Custom color overrides use a validated hex value. Empty values restore automatic choices.

`public/task-style-dom.js` supplies safe task attributes, accessible icon markup, and post-paint CSS-variable application. `public/task-style.css` supplies the shared mark, subdued wash, and one-pixel rule. It is loaded after Flight deck styles. SVG geometry is authored code, never user markup. Preserve CSP and safe rendering.

Task appearance never inherits, changes ownership, or gets copied into prompt records or browser localStorage. Each prompt/response resolves its owning task's current appearance. Rename, reparent, restart, completion, import, and reset preserve the seed. Unique seeds do not guarantee unlimited visually distinct colors/icons; labels remain visible and matching user overrides are allowed.

This reference describes the contract, not verification results. Final integrated checks belong to the parent and must use isolated data/native fixtures.
