---
name: tuios inbox
description: Task-first graphite workbench for inspecting and continuing native TUIOS work.
colors:
  paper: "#15181e"
  white: "#20252d"
  surface-raised: "#2c333d"
  ink: "#edf1f7"
  muted: "#b6beca"
  line: "#444d59"
  control-line: "#697382"
  accent: "#b9d776"
  danger: "#ffd0d8"
  accent-soft: "#303a28"
  accent-hover: "#d1e7a3"
  nav-hover: "#2c333d"
  danger-background: "#38292c"
  danger-line: "#765051"
  warning: "#edce91"
  warning-background: "#302d25"
  warning-line: "#665d43"
  success: "#b4d3bc"
  detail-line: "#526570"
  data-ink: "#c8dae3"
  unread-ink: "#fff"
  unread-background: "#303b2b"
  unread-border: "#81965c"
typography:
  headline:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(21px, 2vw, 27px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-.035em"
  dialog-title:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  metadata-title:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  record-title:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  record-title-unread:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "14px"
    lineHeight: 1.45
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  hint:
    fontFamily: "Arial, Helvetica, sans-serif"
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
  control: "3px"
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

The default live UI is the Task workbench, backed by existing production APIs and SQLite records. Only Task > Agent navigation appears in the left rail. Task histories, agent histories, original prompts, responses, and reply forms occupy the main pane; finished unread responses occupy an independently sortable review queue.

Graphite backgrounds and lime controls follow the merged Rooms/Desk/Ledger comparison. Agent rows carry execution state with green Working, amber Needs input, rose Stopped, flat neutral Idle, and darker dashed Offline treatments. Selection uses a separate outline. Execution state does not determine review state.

Opening a response does not mark it reviewed. Explicit review or a successful reply updates its production unread flag; failed replies retain their drafts and pending status. Native hash links change main-pane content, and Back/Forward restores prior views without rolling back writes. Live updates morph stable DOM nodes instead of replacing focused forms or reading panes.

The tokens above describe [style.css](public/style.css) and [list.css](public/list.css). The [extension sidecar](.impeccable/design.json) and [earlier direction contract](.impeccable/planning/packet-surface.md) describe the preceding Packet list design; they are not the current workbench layout contract.

## Colors

`paper` is the page ground, read-record background, and expanded output background. `white` is the main pane and dialog background; the token retains the production CSS name despite its dark value. `surface-raised` is the input and bulk-action background. Unread records use `unread-background` with `unread-border`, bold white titles, and an explicit lime Unread label and dot. `ink` carries ordinary text, `muted` carries secondary labels, and `data-ink` carries record identifiers and times.

`accent` marks actions, selected type controls, active navigation, focus, unread dots, and selection outlines. `accent-soft` supports button hover, selected type controls, and query chips. `accent-hover` is the primary-button hover color. `nav-hover` supports navigation and type-control hover. The production `forest` custom property is an alias of `accent`, not a second palette color.

`line` separates ordinary sections and records; `control-line` outlines controls and themes scrollbars. `detail-line` strengthens the column header and expanded-output separator. `danger`, `warning`, and `success` accompany explicit status text. Error and warning containers use their corresponding background and line tokens.

**The Read State Rule.** Record backgrounds describe read state, never row parity. Selection adds an accent outline without replacing the read or unread background.

Text selection uses the accent background with paper-colored text. Form carets and native checkbox accents use the accent. Scrollbar thumbs use control-line against paper through `scrollbar-color`.

## Typography

**The Data Lettering Rule.** Use neutral sans for labels, headings, and prose; reserve system monospace for identifiers, times, metadata values, and captured terminal output.

The frontmatter records the observed roles rather than an invented proportional type scale. Headline size is fluid. Metadata headings and dialog titles are smaller fixed roles; dialog titles shrink at the mobile breakpoint. Record titles have ordinary and unread weights. Navigation counts use monospace and tabular numbers; record identifiers and times also use tabular numbers.

Body text inherits the base line height. Descriptions and hints loosen it, Markdown output uses its own reading rhythm, and terminal captures preserve whitespace with wrapping. Closed record titles clamp to two lines; opening the record removes that clamp. Long paths, IDs, notes, and output wrap instead of forcing document overflow.

## Layout

The desktop shell fills the viewport beneath the global navigation. Three independently scrolling areas use `clamp(200px, 15vw, 250px) minmax(0, 1fr) 280px` columns, 4px gaps, and 4px shell padding. Between 900px and 1199px, the outer columns become 200px and 240px. The task rail has exactly two levels; thread and turn navigation stays in the main pane.

The main pane has compact gutters, factual Task/Agent metadata, scoped composition, history links, and full record detail. Secondary index pages retain the shared query shelf and bulk operations. Opening a work record from an index navigates to the main-pane detail rather than expanding its output inline.

Record summaries use six aligned fields when space permits. A main-pane container width of 760px or less switches to labeled mobile fields, independently of viewport width.

Below 900px, bottom Tasks, Content, and Review buttons select one work area at a time. Controls have 44px minimum heights. Metadata and composer fields stack, paths and output wrap, and dialogs retain bounded scrolling.

**The Scoped Inbox Rule.** Task and Agent pages place metadata above work and constrain the query by Task ID or native Agent/pane ID. Scope is intrinsic to the route, not a removable chip or a display-name match.

## Elevation & Depth

Separators and backgrounds define ordinary content hierarchy. Agent state rows add distinct borders and soft offset shadows: Working is light, Needs input is stronger, Stopped is strongest, while Idle and Offline have no shadow.

Native HTML dialogs use the one large blurred shadow and a dim backdrop. Toasts and the shared index bulk-action bar use the smaller blurred shadow. Selection controls sit above records; workbench and index action bars stick to the top of their scrolling area so bulk actions remain available below long lists.

Selection and focus outlines remain independent of execution state. No gradient or halo is used.

## Shapes

Controls and chips share the control radius. Dialogs use the slightly larger dialog radius; aligned records and navigation remain square. Status marks are small circles made in CSS, always accompanied by words. Borders distinguish interactive controls from flat content. The close control belongs to the native dialog, not a decorative icon vocabulary.

## Components

### Buttons and form fields

Primary buttons use accent fill and paper text, with the lighter accent-hover state. Ordinary buttons begin transparent with ink text and a control-line border; hover adds accent text and border over accent-soft. Danger actions keep danger text and gain the danger background and border on hover. Disabled buttons retain the production opacity and not-allowed cursor.

Inputs, native selects, and textareas use surface-raised, ink text, opaque muted placeholders, and accent carets. Labels are visible and separate from placeholders. Focused fields use an accent outline with the field-specific offset; other keyboard-focused elements use the global focus-visible outline. Buttons transition color, border, and background only. Reduced-motion preferences disable transitions and animations and restore automatic scrolling without removing content.

### Navigation and query controls

Navigation is a native link set with `aria-current` on the active page. Active links use accent text and a bottom rule; hover uses nav-hover. The type controls expose independent `aria-pressed` state. Turns and Commands form an OR union with search, property filters, and sort. All is the exclusive reset; when neither type is active, All is active. Query chips remove ordinary filters and turn danger-colored on hover. They never remove the intrinsic detail-page scope.

### Records and mobile fields

Read and unread records share field geometry. Unread titles use unread-ink and the heavier title role, with an explicit Unread label. Index selection keeps its read-state background. Record links open full main-pane details with Markdown, provenance, editable properties, and threaded continuation. Opening alone never clears unread state.

Recent work, task and agent histories, the review queue, left-rail task/agent groups, and task members use native checkboxes separate from navigation links. Each list owns its selection and shows a selected count, select-all control with a mixed state, and contextual bulk actions. Selection uses an outline without changing read-state backgrounds. In-flight controls are disabled, failures retain selection, and live updates preserve checked state. History and member selections reset on route changes.

The left rail is titled Task groups, with a short hierarchy explanation, Manage tasks and Manage agents links, Agents & panes labels beneath tasks, and a Not assigned to a task group. Task and agent archiving hides navigation entries but does not stop panes or archive their records.

### Metadata and composer

Task metadata contains actual paths, status, notes, and member panes. Agent metadata describes the native recipient and its task assignment. The global inline composer lists each Agent once and only agentless Panes separately, deduplicated by native ID. Sending accepts real native work; acceptance is not a completion claim. Task composition remains task-scoped. Focused composer, metadata, and reply drafts survive SSE refresh.

**The Creation Continuation Rule.** A New Task, New Agent, or New Pane choice uses real creation APIs and returns to its initiating selector. Cancel or failure preserves the caller and draft. Agent selection waits for the exact returned startup thread and native pane, never for an unrelated ready session.

### Dialogs and filesystem selection

Creation, task composition, profile editing, mail, and terminal inspection use native HTML dialogs with bounded width and scrollable height. Errors remain in the active form. The terminal inspector is a wider snapshot dialog, not a browser terminal or canonical answer stream. Project and existing-worktree Browse controls open the backend host's native directory chooser. Executable Browse opens its native file chooser, and typing a PATH command remains valid. Canceling a picker leaves the existing input unchanged. These dialogs select the backend filesystem, not the browser device's filesystem.

Native TUIOS approvals remain in an attached client, including ACP approvals. Tailnet access and browser human-approval transport are not shipped. This document records visible focus treatment, not a full keyboard or screen-reader audit.

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
- Turn Task or Agent links into inline work accordions.
- Invent ornamental cards, imagery, gradients, textures, or display typography.
- Add extra palette tokens from the derived preview ramps.
- Present accepted work as completed work or failed startup as ready.
- Describe native approvals, tailnet access, or browser-device filesystem picking as shipped.

The terminal inspector retains its existing uppercase eyebrow. It is not a reusable heading rule.
