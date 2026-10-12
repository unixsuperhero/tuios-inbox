# Task-first outline: design brief

Mode: Operate. Scope: the whole tuios inbox app. Status: brief awaiting confirmation. No production code is changed by this document. The visual world stays Flight deck as recorded in [DESIGN.md](../../DESIGN.md); the structure underneath it is replaced.

Decisions already made by the user (2026-10-11): layout is **One outline**; each queue chooses manual or automatic, manual by default; a task owns a branch plus its pull request and checks; omp is the main harness and default executor, runs non-Anthropic models, and its sessions and todos feed tasks; this pass ends in a clickable mock with synthetic data.

## 1. Job and audience

The owner, steering many coding agents across TUIOS sessions, mostly from a desktop browser and sometimes from a phone on the tailnet. They arrive with a thought ("do this", "ask that") or with a question ("what finished, what needs me"). Both must be answerable from one screen without choosing a page first.

## 2. Outcome and proof

- Writing down a task or a prompt takes one line and one key. It never fails and never asks for anything.
- Almost everything on screen sits under a task. What does not sits in a visible **No task** group, not in a hidden corner.
- Running is the only moment the app is strict. Missing facts are named there, next to the Run control, with the fix in place.
- A task shows the truth from four systems side by side: its prompts and queue (this app), its panes and agent state (TUIOS), its executor and todos (omp, or Claude Code), and its branch, pull request and checks (git).

## 3. The model

Four records. Only `id` and the text are ever required.

```js
task   = { id, title, parent_id?, repo?, branch?, home?, harness?, model?, queue_mode? }
prompt = { id, body, task_id?, target?, harness?, model?, position, state }
run    = { id, prompt_id, pane_id, host, harness, state, started, finished?,
           response, source, head_before?, head_after?, commits: [] }
pane   = { id /* tuios window uuid */, session, host, harness, state, task_id? }

prompt.state: 'saved' | 'queued' | 'running' | 'blocked' | 'done'
run.state:    'working' | 'needs_input' | 'done' | 'errored' | 'unknown'
```

Today's `turn` becomes `run`. Today's Queues page (unread output waiting for review) becomes the **Needs me** view; the word **queue** now means prompts waiting to run.

### Inheritance

A missing field is looked up through its parents. Nothing is copied, so changing a parent changes every child that did not override it.

```js
// lookup order for repo, branch, home, harness, model, queue_mode
run -> prompt -> task -> parent task -> ... -> app default   // default harness: omp

// where a new thing gets its task without anyone choosing one
prompt typed under a task line        -> that task
prompt typed into a pane              -> pane.task_id
reply to a run                        -> the run's prompt's task, same pane
pane launched from a task             -> that task
subtask                               -> parent's repo, branch, home, harness
omp todo item in a pane               -> subtask of that pane's task
commit made during a run              -> that run's task
branch or pull request                -> the task whose branch matches
```

An inherited value is shown dimmed with its source, for example `fix-parser (from Fix parser)`. A value set on the record itself is shown plain. With no parent to inherit from, the record is an orphan and lands under **No task**.

### Example

```js
{ title: 'Fix parser', repo: '~/proj/tuios-inbox', branch: 'fix-parser',
  pr: { number: 42, state: 'open', checks: 'failing' }, queue_mode: 'auto',
  children: [
    { title: 'Tokenizer edge cases',            // inherits repo, branch, harness
      prompts: [
        { body: 'Add tests for nested quotes', state: 'done',
          runs: [{ harness: 'omp', state: 'done', commits: ['d4e5f6 Add nested quote tests'] }] },
        { body: 'Now make them pass', state: 'queued' } ] },
    { title: 'Update README', harness: 'claude-code' }   // overrides one field
  ] }
// No task
{ body: 'what does settle_seconds default to?', state: 'saved' }   // orphan prompt, kept
```

## 4. Saving and running

Saving a prompt has two outcomes and one key each.

| Key | Outcome | Checks |
|---|---|---|
| Enter | Saved to the queue of its task, or to the No task queue | None |
| Cmd+Enter | Run now | Preflight |

Preflight resolves every field through inheritance, then sorts what it finds.

```js
preflight(prompt) = {
  blocks: [                       // Run is disabled until each is fixed
    'no text',
    'nowhere to run: no pane at rest and no repo directory to launch in',
    'target pane is waiting on its own question',   // never type over a prompt
    'target pane is gone',
    'no harness available on this host'
  ],
  warns: [                        // Run stays enabled
    'repo is on main, task expects fix-parser',
    'working tree has uncommitted changes',
    'pull request checks are failing'
  ]
}
```

- Each block is a row beside the Run control with its fix in place: a pane selector, a directory field with the OS directory picker, a harness selector.
- A blocked prompt is never lost. **Save to queue instead** is always offered next to the blocks.
- A manual queue runs only when the user presses Run on a prompt or **Run next** on the queue.
- An automatic queue runs its next prompt when the executor comes to rest. A prompt that fails preflight becomes `blocked`, the queue holds at that prompt, and the item appears in Needs me. It holds instead of skipping because later prompts usually depend on earlier ones.
- Queue mode inherits like any other field. The No task queue is always manual.

## 5. The screen

One outline fills the work area. A rail of saved views sits left; the selected line opens on the right.

```
+------+----------------------------------------+---------------------------+
| rail | capture line                           | detail of selected line   |
|      +----------------------------------------+                           |
|      | v Fix parser        2 queued  fix-parser  PR 42 failing            |
|      |   v Tokenizer edge cases                |  facts (plain or inherited)|
|      |     > Add tests for nested quotes  done |  queue + mode + Run next  |
|      |       omp  done  1 commit      UNREAD   |  or prompt + preflight    |
|      |     > Now make them pass       queued   |  or run output + reply    |
|      |   > Update README                       |                           |
|      | v No task                               |                           |
|      |   > what does settle_seconds default to |                           |
+------+----------------------------------------+---------------------------+
```

**Lines.** Three kinds, told apart by a leading mark and a word, never by colour alone: task, prompt (`>`), run. Runs nest under their prompt, prompts under their task, subtasks under their parent. Each line carries right-aligned facts in fixed columns: queued count, running state, unread, branch, pull request and checks. Unread keeps the existing read-state treatment.

**Capture line.** Always at the top, focused with one key from anywhere. Plain text makes a task; text starting with `>` makes a prompt. The new line goes under the selected task, or top level and No task when nothing is selected. A chip in the capture line names where it will land and can be cleared with Backspace.

**Outline editing.** Enter on a line opens a new sibling below it. Tab and Shift+Tab re-parent, which changes what the line inherits. A move control gives the same re-parenting to touch and keyboard users without dragging.

**Detail.** For a task: facts with their sources, the queue with its mode switch and Run next, panes, notes, commits, pull request and checks. For a prompt: full text, target, preflight, Run now and Save to queue, and its runs. For a run: the response as Markdown, provenance and capture certainty, commits made, and a reply box. A reply is a new prompt that inherits the task and targets the same pane.

**Rail.** Saved views replace the Inbox, Queues, Prompts and Tasks pages; each is the same outline filtered: Everything, Needs me, Running, Queued, No task, Archive. TUIOS, Agent profiles, History and Collectors stay as secondary destinations.

**Phone.** The outline takes the full width. Opening a line pushes the detail as its own page. The capture line is fixed at the bottom above the keyboard. Fact columns fold into a second labelled row per line.

## 6. States and ranges

- Realistic size: 5 to 40 open tasks, up to 4 levels deep, 0 to 30 prompts per task, dozens of runs per day. The outline must stay scannable at 300 visible lines; closed tasks collapse to one line with counts.
- First run: an empty outline, the capture line, and two example lines showing what a task and a prompt look like when typed.
- Orphans: the No task group is always present, shows its count, and offers bulk move into a task.
- Git absent or partial: no repo, a directory that is not a repository, no pull request for the branch, or the pull request service unreachable. Each shows as a plain fact, not an error.
- Capture uncertainty: partial, truncated or summary-only responses keep their source label on the run line.
- Live updates never move, collapse or re-render a line that is being edited, and never steal focus from the capture line or a reply box.

## 7. Boundaries and anti-goals

- A task is never required. No dialog, selector or validation may stand between the user and a saved line.
- No creation dialogs. Creation is typing a line.
- The app does not create worktrees. Whether it may create or switch branches is open below.
- Any directory field uses the OS directory picker, with typing allowed beside it.
- Human approvals keep their existing authority rules. A queued prompt never answers a pane's question.
- The Flight deck palette, type and control shapes are unchanged.

## 8. Open decisions

1. May the app create or check out a task's branch at run time, or does it only report a mismatch?
2. Are omp todos imported one way into subtasks, or kept in sync both ways?
3. Where pull request and check data comes from, and when it refreshes. The assumed answer is the `gh` command line on entry and on explicit refresh, with no polling timer.
4. Whether a blocked prompt in an automatic queue should hold the queue, as written here, or be skipped.
5. How this model lands in the Portfolio merge, which already settled on one task table.
