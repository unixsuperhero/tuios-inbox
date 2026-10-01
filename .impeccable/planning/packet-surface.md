# List workspace

Mode: Operate. Scope: all list pages and dedicated Task and Agent detail pages in tuios inbox.

The user selected Packet capture workbench from the five runnable prototypes. Preserve current work, Markdown rendering, native permissions, drafts, query semantics, and live-update behavior. This change does not implement tailnet access or human-approval transport.

## Direction contract

THESIS: An inspectable stream of AI work. Replace the soft card pile with aligned records, stable state fields, and direct Task and Agent navigation.

OWN-WORLD: Dark blue-black workbench surfaces, teal actions and focus, neutral sans labels, monospaced identifiers and times. Read rows use #15232b; unread rows use #1c2b34, never alternating stripes. Explicit unread marks supplement the background.

STORY: Scan work, narrow to Turns or Commands, inspect output, and compose the next operation. Follow a Task or Agent to metadata and its own inbox without losing scope.

FIRST VIEWPORT: Six-view top navigation, compact title and real count, inline composer with recipient selection, then All/Turns/Commands controls and the shared search/filter/sort shelf over aligned work rows. Task and Agent pages place editable, factual metadata above the scoped inbox. Mobile stacks record fields without document overflow.

FORM: Packet capture workbench, the user's selected prototype and top-ranked candidate from seed ed6959c3. Code-led. Signature interaction: inspect a record in place while search, selection, and drafts survive live updates. State transitions are brief and functional; reduced motion preserves visible content.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior constraints

- All is the default and exclusive reset. Turns and Commands may both be active. When neither is active, All is shown active. The type union composes with ordinary search, filters, and sort.
- Task and Agent indexes use real links, not accordions. Scope uses Task IDs or native Agent/pane IDs, never display names or removable filter chips.
- The recipient menu shows Agents once and only agentless Panes separately, deduplicated by native ID.
- Every Task, Agent, or Pane record selector offers the corresponding New option. Creation uses real APIs and retains the initiating selection context and typed draft on cancel or failure.
- Agent creation resolves the exact startup thread to its returned native pane ID before selecting it. Failed, blocked, or closed startup is never presented as ready.
- Touched directory inputs retain real OS Browse controls. No background refresh replaces a focused composer, metadata editor, or reply draft.

## Reference

The approved visual reference is the runnable Packet prototype at `.impeccable/prototypes/list-directions/packet.js` and `packet.css`, with the captured desktop and mobile surfaces in `.impeccable/review/prototypes/packet-1440.png` and `packet-390.png`. This is a code-led reference, not an image-generated comp authority.
