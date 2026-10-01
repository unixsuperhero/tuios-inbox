---
name: tuios inbox
description: Packet capture workbench for inspecting and continuing native TUIOS work.
colors:
  paper: "#101b22"
  white: "#15232b"
  surface-raised: "#1c2b34"
  ink: "#dfeaf0"
  muted: "#b8ccd6"
  line: "#354751"
  control-line: "#4c626e"
  accent: "#79c9c3"
  danger: "#ffb7b0"
  accent-soft: "#203a3a"
  accent-hover: "#a0ded8"
  nav-hover: "#263a44"
  danger-background: "#38292c"
  danger-line: "#765051"
  warning: "#edce91"
  warning-background: "#302d25"
  warning-line: "#665d43"
  success: "#b4d3bc"
  detail-line: "#526570"
  data-ink: "#c8dae3"
  unread-ink: "#fff"
typography:
  headline:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(26px, 3vw, 36px)"
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
  gutter-mobile: "16px"
  section-small: "20px"
  section: "24px"
  gutter: "28px"
components:
  button:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.paper}"
  button-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-danger-hover:
    backgroundColor: "{colors.danger-background}"
    textColor: "{colors.danger}"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  navigation:
    textColor: "{colors.muted}"
    rounded: "{rounded.record}"
    padding: "20px 12px 18px"
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
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.record}"
    padding: "18px 16px"
  record-unread:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.unread-ink}"
    typography: "{typography.record-title-unread}"
  composer:
    padding: "18px 0"
  metadata:
    padding: "0 0 22px"
  dialog:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "26px"
---

## Overview

**Creative North Star: "Packet capture workbench"**

The product is tuios inbox. Its Operate interface presents native TUIOS work as aligned, inspectable records. The first view puts navigation, the page title, an inline composer, and shared query controls before the work list. Task and Agent detail pages put factual, editable metadata above their scoped inboxes.

This is the implemented code-led Packet world, not an image-comp reproduction. Flat blue-black backgrounds distinguish ground, read records, and unread records. Teal identifies actions and focus. Neutral Arial labels and headings carry ordinary language; system monospace carries identifiers, timestamps, terminal output, and metadata values. The interface adds no illustrative imagery or simulated material.

**Key Characteristics:**
- Aligned records with explicit read state and stable fields.
- In-place output inspection and direct Task and Agent navigation.
- Shared query controls and real native-work composition.
- Metadata above the scoped inbox, with drafts preserved during live updates.
- Mobile field labels and brief, functional state transitions.

The normative tokens above describe [style.css](public/style.css) and [list.css](public/list.css). The [extension sidecar](.impeccable/design.json) records states, breakpoints, motion, shadows, and independent component examples. Its synthesized tonal ramps are derived preview aids, not additional shipped colors. The [direction contract](.impeccable/planning/packet-surface.md) records the selected world.

## Colors

`paper` is the page ground and expanded output background. `white` is the read-record and dialog background; the token retains the production CSS name despite its dark value. `surface-raised` is the unread-record, input, rail, and bulk-action background. `ink` carries ordinary text, `muted` carries secondary labels, and `data-ink` carries record identifiers and times. `unread-ink` strengthens unread titles.

`accent` marks actions, selected type controls, active navigation, focus, unread dots, and selection outlines. `accent-soft` supports button hover, selected type controls, and query chips. `accent-hover` is the primary-button hover color. `nav-hover` supports navigation and type-control hover. The production `forest` custom property is an alias of `accent`, not a second palette color.

`line` separates ordinary sections and records; `control-line` outlines controls and themes scrollbars. `detail-line` strengthens the column header and expanded-output separator. `danger`, `warning`, and `success` accompany explicit status text. Error and warning containers use their corresponding background and line tokens.

**The Read State Rule.** Record backgrounds describe read state, never row parity. Selection adds an accent outline without replacing the read or unread background.

Text selection uses the accent background with paper-colored text. Form carets and native checkbox accents use the accent. Scrollbar thumbs use control-line against paper through `scrollbar-color`.

## Typography

**The Data Lettering Rule.** Use neutral sans for labels, headings, and prose; reserve system monospace for identifiers, times, metadata values, and captured terminal output.

The frontmatter records the observed roles rather than an invented proportional type scale. Headline size is fluid. Metadata headings and dialog titles are smaller fixed roles; dialog titles shrink at the mobile breakpoint. Record titles have ordinary and unread weights. Navigation counts use monospace and tabular numbers; record identifiers and times also use tabular numbers.

Body text inherits the base line height. Descriptions and hints loosen it, Markdown output uses its own reading rhythm, and terminal captures preserve whitespace with wrapping. Closed record titles clamp to two lines; opening the record removes that clamp. Long paths, IDs, notes, and output wrap instead of forcing document overflow.

## Layout

The desktop rail is a horizontal, wrapping navigation band. Main content is centered with a maximum width of 1600px. The headline follows a compact topbar. The inline composer uses a recipient column beside a flexible prompt column, then an action row. The query shelf wraps search, property filters, sort, counts, creation controls, and removable chips around the available space.

Desktop records use a shared six-column grid for type, title, Agent, Task, status, and time. A checkbox sits before the grid; the Inspect, Close, or Open affordance sits after it. The column header and each record share alignment. Task and Agent indexes use links, while work records use native details and summary elements for inline inspection.

At 1100px and below, connection controls move to a full-width rail row and the query shelf relinquishes its right alignment. At 760px and below, the composer becomes one column, navigation becomes compact, and the table-like column header disappears. Each record becomes a two-column field grid: the title spans the first row, type and Agent share the next, Task spans its own row, then status and time share a row. Visible labels come from each field's `data-label`. Empty Task or time fields do not reserve empty content. Inspect moves below the fields; link records stack their Open action. Metadata labels and values stack, pane controls wrap below their content, and the bulk-action bar stretches across the list.

At 360px and below, outer gutters tighten, filters wrap further, sort gets its own line, Browse controls wrap, and the heading may wrap. The exact responsive gutter tokens are in frontmatter; the breakpoint extensions are in the sidecar.

**The Scoped Inbox Rule.** Task and Agent pages place metadata above work and constrain the query by Task ID or native Agent/pane ID. Scope is intrinsic to the route, not a removable chip or a display-name match.

## Elevation & Depth

The workbench is flat. Background changes, single-pixel separators, and outlines define its ordinary hierarchy; records have no ornamental drop shadow. Opening a record adds an accent separator, while hover adds a control-line separator.

Native HTML dialogs use the one large blurred shadow and a dim backdrop. Toasts and the sticky bulk-action bar share the smaller blurred shadow. These exact values live in the sidecar rather than unsupported frontmatter properties. The bulk bar remains near the viewport bottom, and the toast appears above ordinary content.

Selection, focus, and open-record inset outlines are state markers, not elevation levels. No depth gradient, halo, or hard offset shadow belongs to this system.

## Shapes

Controls and chips share the control radius. Dialogs use the slightly larger dialog radius; aligned records and navigation remain square. Status marks are small circles made in CSS, always accompanied by words. Borders distinguish interactive controls from flat content. The close control belongs to the native dialog, not a decorative icon vocabulary.

## Components

### Buttons and form fields

Primary buttons use accent fill and paper text, with the lighter accent-hover state. Ordinary buttons begin transparent with ink text and a control-line border; hover adds accent text and border over accent-soft. Danger actions keep danger text and gain the danger background and border on hover. Disabled buttons retain the production opacity and not-allowed cursor.

Inputs, native selects, and textareas use surface-raised, ink text, opaque muted placeholders, and accent carets. Labels are visible and separate from placeholders. Focused fields use an accent outline with the field-specific offset; other keyboard-focused elements use the global focus-visible outline. Buttons transition color, border, and background only. Reduced-motion preferences disable transitions and animations and restore automatic scrolling without removing content.

### Navigation and query controls

Navigation is a native link set with `aria-current` on the active page. Active links use accent text and a bottom rule; hover uses nav-hover. The type controls expose independent `aria-pressed` state. Turns and Commands form an OR union with search, property filters, and sort. All is the exclusive reset; when neither type is active, All is active. Query chips remove ordinary filters and turn danger-colored on hover. They never remove the intrinsic detail-page scope.

### Records and mobile fields

Read and unread records share field geometry. Unread titles use unread-ink and the heavier title role; an accent dot and explicit Unread text supplement the background difference. Checked records retain that state background and add an accent inset outline. Expanded records show output on paper, with preserved Markdown rendering, provenance, editable properties, and threaded continuation. Native summary focus stays inside the record boundary. Linked Task and Agent titles change to accent on hover.

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

The terminal inspector retains an uppercase eyebrow in the existing build. It is not a reusable heading rule and is not canonized here. No implementation change is made by this documentation pass.
