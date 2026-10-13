---
name: tuios inbox
description: Flight deck task navigation for inspecting and continuing native TUIOS work.
colors:
  paper: "#17212b"
  white: "#17212b"
  surface-raised: "#202f3b"
  ink: "#e9eff3"
  muted: "#bfccd6"
  line: "#435463"
  control-line: "#647786"
  accent: "#ffb54a"
  danger: "#edbeb8"
  accent-soft: "#344656"
  accent-hover: "#ffc570"
  nav-hover: "#243442"
  danger-background: "#38292c"
  danger-line: "#765051"
  warning: "#edce91"
  warning-background: "#302d25"
  warning-line: "#665d43"
  success: "#bbd5c5"
  detail-line: "#526570"
  data-ink: "#c8dae3"
  unread-ink: "#fff"
  unread-background: "#202f3b"
  unread-border: "#647786"
typography:
  headline:
    fontFamily: "FlightCondensed, Arial Narrow, sans-serif"
    fontSize: "44px; 38px below 1050px; 36px below 760px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0"
  dialog-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  metadata-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  record-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  record-title-unread:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  hint:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  data:
    fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.55
  reference:
    fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, monospace"
    fontSize: "11px"
    lineHeight: 1.6
rounded:
  control: "2px"
  dialog: "4px"
  record: "0"
  status: "50%"
spacing:
  compact: "4px"
  small: "8px"
  field: "12px"
  gutter-mobile: "8px"
  section-small: "20px"
  section: "24px"
  gutter: "10px"
components:
  button:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "5px 8px"
  button-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "5px 8px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.paper}"
  button-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "5px 8px"
  button-danger-hover:
    backgroundColor: "{colors.danger-background}"
    textColor: "{colors.danger}"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
  navigation:
    textColor: "{colors.muted}"
    rounded: "{rounded.record}"
    padding: "8px"
  navigation-active:
    textColor: "{colors.accent}"
  type-toggle:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
  type-toggle-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  query-chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  record-read:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.record}"
    padding: "18px 16px"
  record-unread:
    backgroundColor: "{colors.unread-background}"
    textColor: "{colors.unread-ink}"
    typography: "{typography.record-title-unread}"
  composer:
    padding: "10px 0"
  metadata:
    padding: "0 0 12px"
  dialog:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "26px"
---

## Overview

Tasks is the default planning page, backed by production APIs and SQLite records. Its main outline and task navigation contain tasks and subtasks only. Expand a task inline to add a next step or subtask, compose a multiline prompt, or open settings. Queue is the separate aftermath workspace for results, questions, failures, documents, provenance, and continuation. Advanced activity and native views remain available.

Dark blue surfaces, condensed FlightCondensed headings, and amber actions follow the Flight deck direction. Agent rows retain explicit Working, Needs input, Stopped, Idle, and Offline treatments without shadows. Selection uses a separate outline. Execution state does not determine review state.

Opening a response marks it read; **Mark as unread** restores the unread flag, and a successful reply clears it. Failed replies retain their drafts. Execution state is separate from review state. Retained activity and legacy Queues keep their shell-command filtering. Native hash links and Back/Forward restore content without rolling back writes. Existing SSE updates morph stable DOM nodes while preserving focus, drafts, scrolling, and disclosures. No refresh timer is added.

[flight.css](public/flight.css) preserves the shared shell and record treatment after the base styles. [task-style.css](public/task-style.css) loads after Flight deck styles and adds only shared task identity. The frontmatter still describes the common palette and components. Historical comparison assets under `.impeccable/` are not served by the application.

## Colors

`paper` and `white` are the dark blue page, main-pane, and dialog ground. Read list records use #1b2833; unread records use #202f3b with bold white titles and an explicit Unread label and dot. `surface-raised` is the input and bulk-action background. `ink` carries ordinary text and `muted` carries secondary labels.

`accent` marks actions, selected type controls, focus, and selection outlines. Active navigation uses white text on #344656 with a #586d7d border. Primary buttons hover at #ffc570. Unread indicators use light text; `forest` is the #bbd5c5 success color.

`line` separates ordinary sections and records; `control-line` outlines controls and themes scrollbars. `detail-line` strengthens the column header and expanded-output separator. `danger`, `warning`, and `success` accompany explicit status text. Error and warning containers use their corresponding background and line tokens.

**The Read State Rule.** Record backgrounds describe read state, never row parity. Selection adds an accent outline without replacing the read or unread background.

Text selection uses the accent background with paper-colored text. Form carets and native checkbox accents use the accent. Scrollbar thumbs use control-line against paper through `scrollbar-color`.

### Task identity is a narrow palette exception

Each task and subtask owns an immutable unique numeric seed, a saturated automatic color, and an authored icon. The automatic palette keeps the seed-derived hue at 78% saturation and 72% lightness; the five named themes use distinct green, cyan, lavender, rose, and gold colors. Appearance never inherits. Theme, icon, and custom hex color overrides are independent; a native color input provides direct color selection. Empty overrides restore automatic choices, and reset clears all appearance overrides without changing the seed. Restart, rename, reparent, completion, and repeated import preserve identity, including archived and OMP-imported tasks. Deleted seeds are not recycled.

Warn when a custom color has less than 3:1 contrast against the Flight deck background, without blocking the user's choice. Visible labels and unchanged status/focus treatments remain necessary.

Unique seeds do not guarantee unlimited perceptual uniqueness. Icons repeat, nearby colors can look similar, and users can intentionally choose duplicate styles. Pair the mark with a visible task label; use neutral treatment for unknown or unassigned tasks.

Apply identity consistently to task navigation, inline planning, prompts, replies, responses, Queue, and retained activity/history. A nested subtask or result sets its own identity rather than taking the parent's color. Prompt-first ownership preserves explicit No task. Confine task color to the mark, tinted task labels, background wash, and one-pixel rules. Queue rows and task navigation use a 20% wash; read queue rows use 12%, selected rows 10%, and the Queue reader 14%. The selected queue row keeps its base background and gains a two-pixel light outline. Other task surfaces retain the shared 9% wash. Do not recolor actions, keyboard focus, or status text. Keep read/unread typography and indicators. Shared helpers use authored SVG and validated CSS variables without loosening CSP or accepting user markup.

## Typography

Use FlightCondensed for the brand and page headings, platform sans-serif for labels and prose, and system monospace for identifiers, times, metadata values, and captured terminal output. The bundled Barlow Condensed font retains its OFL license.

Page headings are 44px, 38px below 1050px, and 36px below 760px. Record titles are 16px with ordinary and bold unread weights. Navigation counts use monospace and tabular numbers; record identifiers and times also use tabular numbers.

Body text inherits the base line height. Descriptions and hints loosen it, Markdown output uses its own reading rhythm, and terminal captures preserve whitespace with wrapping. Closed record titles clamp to two lines; opening the record removes that clamp. Long paths, IDs, notes, and output wrap instead of forcing document overflow.

## Layout

The desktop shell keeps a left navigation column and a scrolling work area. Tasks uses a task/subtask-only planning outline with inline expansion rather than requiring a separate selected-detail pane for creation. Queue separates its attention list from the result reader. Retained legacy Queues still has its task-bucket column and reading pane. Native hash links and browser history reveal the selected content.

The main pane retains Flight deck gutters and compact row geometry. Inline task settings use progressive disclosure, but effective directory, harness, model, and launch mode stay beside dispatch. Completed tasks are available under disclosure. Retained Inbox/index query controls and bulk operations remain available.

Record summaries use six aligned fields when space permits. A main-pane container width of 760px or less switches to labeled mobile fields, independently of viewport width.

On narrow screens, task planning and settings stack without forcing horizontal overflow; Queue keeps review and continuation accessible. Controls retain 44px mobile minimum heights, paths wrap, and dialogs have bounded scrolling. Retained activity work areas keep their mobile navigation controls.

**The Scoped Inbox Rule.** Task and Agent pages place metadata above work and constrain the query by Task ID or native Agent/pane ID. Scope is intrinsic to the route, not a removable chip or a display-name match.

## Elevation & Depth

Separators and backgrounds define ordinary content hierarchy. Agent state rows keep distinct borders and explicit state text without shadows.

Native HTML dialogs use the one large blurred shadow and a dim backdrop. Toasts and the shared index bulk-action bar use the smaller blurred shadow. Selection controls sit above records; workbench and index action bars stick to the top of their scrolling area so bulk actions remain available below long lists.

Selection and focus outlines remain independent of execution state. No gradient or halo is used.

## Shapes

Controls and chips share the control radius. Dialogs use the slightly larger radius; aligned records and navigation remain square. Status marks are small CSS circles accompanied by words. Task identity marks use authored SVG icons with visible task labels, not status symbols. Borders distinguish interactive controls from flat content. The close control stays part of the native dialog.

## Components

### Buttons and form fields

Primary buttons use accent fill and paper text, with the lighter accent-hover state. Ordinary buttons begin transparent with ink text and a control-line border; hover adds accent text and border over accent-soft. Danger actions keep danger text and gain the danger background and border on hover. Disabled buttons retain the production opacity and not-allowed cursor.

Inputs, native selects, and textareas use surface-raised, ink text, opaque muted placeholders, and accent carets. Labels are visible and separate from placeholders. Focused fields use an accent outline with the field-specific offset; other keyboard-focused elements use the global focus-visible outline. Buttons transition color, border, and background only. Reduced-motion preferences disable transitions and animations and restore automatic scrolling without removing content.

### Navigation and query controls

Navigation is a native link set with `aria-current` on the active page. Active links use white text on a blue raised surface; hover uses nav-hover. The type controls expose independent `aria-pressed` state. Turns and Commands form an OR union with search, property filters, and sort. All is the exclusive reset. Query chips remove ordinary filters, never the intrinsic detail-page scope.

### Native TUIOS hierarchy

The TUIOS navigation entry opens native sessions, numbered workspaces, and terminal panes. A native window and its pane share one UUID. Agent state belongs to that UUID. Breadcrumbs and an expandable hierarchy accompany searchable Name, Host, State, and Actions tables. Pane details contain escaped native metadata, agent activity, and a bounded terminal snapshot, not a browser terminal.

The always-visible **TUIOS** link opens **Overview** (`#tuios-overview`) in the full main pane without a duplicate hierarchy sidebar. Session headings show the native host alias, the local backend hostname when available, attachment state, and pane count. Each session has its own horizontally scrollable workspace tabs and one visible pane list. Empty workspaces remain available as tabs and move destinations. Agent rows display their harness, state, reported message, host, native UUID, and task assignment without duplicating the pane. **Filter panes** is a default-closed disclosure. This shows membership, not terminal geometry.

Pane links open native inspection without changing terminal focus. Workspace tabs support arrow keys, Home, and End; per-session selections survive native reads and browser-tab reloads. Dragging uses actual pane UUIDs and permits only same-session workspace tabs or panels as destinations. The shared **Move pane** dialog provides keyboard and touch access to every native workspace. Native cross-session transfer is unavailable. Updates pause during active drags and open dialogs; keyed rendering preserves controls and drafts.

Browse actions never change terminal focus or select a workspace. Focus and selection have explicit controls. Session layout applies to the terminal-selected workspace and states that limit in the form. Splits require an attached client with tiling enabled. Moves retain the pane UUID and stay within one session. Destructive actions and interruption require a confirmation checkbox and explicit submit. Native errors stay in the active form.

Task homes specify future launch placement. Pane assignment specifies work grouping. Changing either does not implicitly change the other. Existing pane controls use the pane’s execution session rather than a task’s mutable home. Local launch directories use the backend’s native directory chooser; remote launches inherit native defaults.

Native state refreshes on entry, explicit reads, and existing event notifications, without a new polling timer. Hierarchy expansion, search filters, form drafts, focus, and open dialogs survive live updates. Agent startup links show actual startup outcomes instead of treating an accepted request as readiness. Native grants and human approvals remain authoritative.

### Records and mobile fields

Read and unread records share field geometry. Unread titles use bold white text and an explicit Unread label. Selection keeps the read-state background. Record links open full main-pane details with Markdown, provenance, editable properties, and threaded continuation. Opening a work record marks it read.

The Prompts index uses the existing `#turns` route and excludes command records. Turn details always show the full captured text under an explicit PROMPT heading, including short and unfinished prompts. Working and needs-input turns retain their state and question controls without presenting partial assistant text as a completed response. Open details refresh when prompt capture or state changes, without resetting drafts.

Record headers and table titles use single-line ellipsis without changing their stored text. The PROMPT and RESPONSE bodies remain untruncated and render through the shared Markdown renderer. Body headings, lists, code blocks, and tables retain their normal layout on desktop and mobile.

Turns with neither prompt text nor response text are auto-archived rather than deleted. Pending empty rows stay out of the active lists until capture supplies content. Delayed content restores only automatic archives, preserving the record ID and manual archive decisions. A response-capture flag refreshes open details even when the completion timestamp is unchanged, without replacing reply drafts.

Inbox, task and agent histories, the review queue, task groups, and task members use native checkboxes separate from navigation links. Each list owns its selection and contextual bulk actions. Selection uses an outline without changing read-state backgrounds. In-flight controls are disabled, failures retain selection, and live updates preserve checked state. History and member selections reset on route changes.

The Task groups work area includes hierarchy explanations, Manage tasks and Manage agents links, Agents & panes labels beneath tasks, and a Not assigned to a task group. Task and agent archiving hides navigation entries without stopping panes or archiving their records.

### Metadata and composer

The Tasks outline exposes next-step/subtask creation and multiline prompt composition inline, with separate save and run actions and no required `>` prefix. Execution settings inherit through the task hierarchy unless overridden; appearance never does. Show effective directory, harness, model, and launch mode next to dispatch. Resolve cwd from the nearest task with a project or worktree, preferring that record's worktree. Resolve native session and workspace independently. Untargeted prompts default to a fresh background agent; reuse must be explicit and compatible.

Retained task detail pages keep section-level Edit, Save, and Cancel controls for factual metadata. Created time and Task ID stay immutable. Notes keep independent Markdown add/edit/delete controls and Include in prompts. Marked notes reach agent prompts; shell commands, mail, and approval answers stay unchanged. Drafts survive live updates and edits during an in-flight save.

Advisory preflight findings are warnings with explicit Proceed anyway, or Queue anyway for busy/question targets. `allow_warnings` acknowledges advice, never native permission. Missing cwd/profile warnings explain their fallback before the attempt. Use the native queue rather than typing accidental approvals. Actual native refusals, gone panes, missing executables, and failed launches remain errors with preserved text and recovery controls. Format errors retain drafts for correction.

Do not impose arbitrary title or prompt length caps. Warn about the native queue-message limit and allow saving and explicit attempts. Never truncate or split prompts silently. Automatic queues do not silently acknowledge warnings or human approvals.

Agent metadata describes the native recipient and task assignment. The inline composer lives in a Send work to an agent or pane disclosure; live updates preserve its draft and expanded state. It lists each Agent once and only agentless Panes separately, deduplicated by native ID. Sending accepts real native work, not a completion claim. Task composition remains task-scoped.

Execution host is pane metadata, not task metadata: task members may run on different hosts. Task groups, member rows, agent/pane indexes and details, work-record summaries, review rows, and recipient selectors show the native execution-host label. A matching detailed native pane listing confirms **local** or the reported host name; absent historical metadata shows **Not reported**. Host labels do not change task assignment, routing, or native host configuration.

New Agent and New Pane dialogs include a Host selector populated from registered native hosts. The choice affects only that launch, not task assignment or the future task home. Unavailable hosts remain visible but disabled. Remote launches use native directories rather than local picker paths.

**The Creation Continuation Rule.** A New Task, New Agent, or New Pane choice uses real creation APIs and returns to its initiating selector. Cancel or failure preserves the caller and draft. Agent selection waits for the exact returned startup thread and native pane, never for an unrelated ready session.

### Dialogs and filesystem selection

Primary task, subtask, and prompt creation stays inline. Retained advanced creation flows, profile editing, mail, and terminal inspection use native HTML dialogs with bounded width and scrollable height. Errors remain in the active form. The terminal inspector is a snapshot, not a browser terminal or canonical answer stream. Project and existing-worktree Browse controls retain the backend host's native directory chooser. Executable Browse retains its native file chooser, and typed PATH commands remain valid. Cancel leaves the current input unchanged. Pickers select the backend filesystem, not the browser device's filesystem.

Browser questions and grant-permitted answers retain their existing handling. Held approvals, risk-matched approvals, and other human-only operations still require an attached TUIOS client. Warning overrides and queued prompts cannot bypass those rules. Tailnet access and complete browser human-approval authorization are not shipped by this redesign. This document does not claim a full keyboard or screen-reader audit.

## Do's and Don'ts

### Do

- Use state-based record backgrounds and explicit read-state text.
- Keep selection, read state, and intrinsic query scope independent.
- Use sans labels and monospace data in their recorded roles.
- Put factual metadata above each scoped inbox.
- Preserve typed drafts and creation callers during live updates, cancellation, and failure.
- Show capture provenance, partial output, and uncertain completion honestly.
- Keep visible mobile field labels and native control semantics.

### Don't

- Alternate row backgrounds or replace unread state with selection color.
- Mix panes, prompts, responses, or documents into the primary task/subtask planning tree.
- Invent ornamental cards, imagery, gradients, textures, or display typography.
- Recolor Flight deck controls or read/status treatments with task colors. Task identity is the narrow mark/wash/rule exception, not a new shell palette.
- Present accepted work as completed work or failed startup as ready.
- Treat warning overrides as native authorization or claim complete browser approvals, tailnet access, or browser-device filesystem picking are shipped.

The terminal inspector retains its existing uppercase eyebrow. It is not a reusable heading rule.

## Optional terminal task workspace

The separate `tuios-inbox-tui` executable uses the existing Inbox HTTP API. It owns no database and imports no TUIOS implementation packages. The browser palette and typography above remain browser-specific; the terminal uses indexed colors and reverse-video focus so it works with the terminal's color depth.

- Tasks occupy the left column; the selected task's live windows occupy the right. Narrow terminals show the focused column, switched with Tab.
- Membership comes from canonical `agents.task_id` joined to live native window UUIDs across sessions. A task's session/workspace is its default creation home, not a membership filter.
- Window/session forms retain their name when choosing or creating a task. Cancel restores the prior form and selection context; choosing a task intentionally changes the assignment.
- Short screens remove optional chrome before clipping the name, task scope, and status. Loading and failure remain visible; refresh is explicit, never a polling heartbeat.
- A popup carries its initiating TUIOS client identity. Opening a window uses the generic confirmed `jump-window` interface; failure leaves the task workspace open. TUIOS core has no task-specific action or default task binding.
