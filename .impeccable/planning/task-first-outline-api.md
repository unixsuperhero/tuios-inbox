# Task-first outline: build contract

Companion to [task-first-outline.md](task-first-outline.md) (the design brief). This file is the interface both builders code against. Prototype quality: speed over perfection.

## Ownership (two agents share one working tree; do not edit the other's files; do NOT git commit, stash, reset or checkout)

| Owner | Files |
|---|---|
| backend | `server.mjs`, `public/outline-model.js` (pure, shared by server and browser), `outline-model.test.mjs`, `outline.test.mjs` |
| frontend | `public/outline.js`, `public/outline.css`, `public/index.html`, `public/app.js`, `public/pages.js` (minimal hooks only) |

Backend adds `/outline.js`, `/outline.css`, `/outline-model.js` to the static file map in `server.mjs`.
Another unrelated agent session edits docs/reports in this repo. Leave files you do not own alone.

## Storage (additive migrations only, same style as existing `ALTER TABLE` guards)

```js
tasks  += { branch TEXT '', harness TEXT '', model TEXT '', queue_mode TEXT '' /* '' = inherit */, source TEXT '' /* 'omp-todo' */ }
// tasks.path is the repo; tasks.session/workspace is the home. '' means "not set, inherit".
prompts = { id, body, task_id NULL, target '' /* pane uuid */, harness '', model '', position REAL,
            state 'queued'|'running'|'blocked'|'done'|'errored', error '', created, updated }
turns  += { prompt_id NULL, head_before '', head_after '' }   // a turn is a "run"
```

## Pure module `public/outline-model.js` (no DOM, no fetch, no node imports)

```js
export const DEFAULTS = { harness: 'omp', queue_mode: 'manual' };
export const FIELDS = ['repo', 'branch', 'harness', 'model', 'queue_mode', 'session', 'workspace'];
// resolve(record, tasksById) -> { repo: {value, from}, ... } ; from = 'self' | <task id> | 'default' | 'none'
// record is a task or a prompt; lookup: record -> its task -> parent task -> ... -> DEFAULTS
export function resolve(record, tasksById) {}
// preflight({prompt, resolved, panes, git, profiles}) -> { blocks: [{code, message, fix}], warns: [{code, message}] }
// block codes: 'no_text' | 'nowhere' | 'pane_blocked' | 'pane_gone' | 'no_harness'   fix: 'body'|'target'|'repo'|'harness'
// warn codes:  'branch_mismatch' | 'dirty' | 'checks_failing'
export function preflight(input) {}
// nextInQueue(prompts, taskId) -> the lowest-position prompt in state 'queued' for that task (null task = No task queue)
export function nextInQueue(prompts, taskId) {}
```

## HTTP (all JSON; writes need the existing `x-inbox-request: 1` header; errors are `{error}` with 4xx)

`GET /api/outline` →

```js
{
  defaults: { harness: 'omp', queue_mode: 'manual' },
  tasks: [{ id, title, parent_id, status, archived, created, source,
            own: { repo, branch, harness, model, queue_mode, session, workspace },      // '' / null when not set
            resolved: { repo: { value, from }, branch: {...}, harness: {...}, model: {...}, queue_mode: {...}, session: {...}, workspace: {...} },
            git: { state: 'none'|'not_a_repo'|'ok', head, dirty, commits: [{ sha, subject, at }],
                   pr: null | { number, state, url, checks: 'passing'|'failing'|'pending'|'none' },
                   pr_state: 'ok'|'none'|'unavailable', fetched },
            notes: [...] }],
  prompts: [{ id, body, task_id, target, harness, model, position, state, error, created, updated,
              resolved: {...same shape...}, preflight: { blocks: [...], warns: [...] } }],
  runs: [{ id /* 'turn:<id>' */, prompt_id, task_id, pane_id, pane_name, harness, host, state, unread, archived,
           started, finished, prompt /* first 400 chars */, response_captured, source, commits: [{ sha, subject }] }],
  panes: [{ id, name, session, host, harness, kind, state, task_id, ready /* bool: at rest, may be typed at */ }],
  profiles: [...]
}
```

| Method and path | Body | Result |
|---|---|---|
| `POST /api/tasks` (exists) | `{ title, parent_id?, repo?, branch?, harness?, model?, queue_mode? }`. Only `title` required. `repo` is an alias of the existing `path`. | 201 task |
| `PATCH /api/tasks/:id` (exists) | Any of the same fields; `''`/`null` clears a field back to inherit. `parent_id: null` un-parents. | task |
| `POST /api/prompts` | `{ body, task_id?, target?, harness?, model?, run?: boolean }`. Never fails for missing data. If `target` is a pane with a task and `task_id` is absent, inherit the pane's task. | 201 `{ prompt, ran: boolean, preflight }`. With `run: true` and blocks: prompt is saved with state `blocked`, `ran: false`. |
| `PATCH /api/prompts/:id` | `{ body?, task_id?, target?, harness?, model?, state?: 'queued' }` | prompt |
| `DELETE /api/prompts/:id` | | `{ ok: true }` |
| `POST /api/prompts/:id/run` | | 202 `{ prompt }`, or 409 `{ error, preflight }` and the prompt becomes `blocked` |
| `POST /api/prompts/:id/move` | `{ task_id?: id or null, before?: prompt id or null }` | prompt |
| `POST /api/tasks/:id/run-next` (`:id` may be `none` for the No task queue) | | 202 `{ prompt }` or 409 |
| `POST /api/git/refresh` | `{ task_id }` | the task's fresh `git` object |

Existing endpoints stay: `GET /api/turns/:id` (full prompt and response of a run), `PATCH /api/turns/:id` (unread, archived, task_id), `GET /api/events` (SSE; on any message refetch `/api/outline`), `POST /api/pick-directory`, `GET /api/agents/:id/question`, `POST /api/agents/:id/answer`.

## Behaviour

- Running: resolve fields, run preflight. With a ready `target` pane, send through the existing `promptAgent` path. With no target but a resolved repo and harness, launch a new agent pane for the task through the existing profile-launch path, then send. Record `head_before`. Link the next turn captured on that pane to the prompt (`turns.prompt_id`); when that turn finishes set prompt `done` (or `errored`), record `head_after` and the commits between.
- A reply to a run is `POST /api/prompts` with `{ body, task_id, target: <run pane>, run: true }`.
- Auto queues: when a pane comes to rest and the task whose queue it serves resolves `queue_mode: 'auto'`, run `nextInQueue`. A prompt that fails preflight becomes `blocked` and the queue holds. The No task queue is always manual. Never type at a pane on `needs_input`.
- Git facts are read with `git -C <repo>` and `gh pr view <branch> --json number,state,url,statusCheckRollup`, cached per task, refreshed on first read and on `POST /api/git/refresh`. No new polling timer. `gh` missing or failing gives `pr_state: 'unavailable'`, never an error.
- Turns with no `prompt_id` (typed straight into a pane) still appear in `runs` with `prompt_id: null`; the UI shows them under their task or under No task.
