# tuios inbox visual prototypes

Five interactive visual directions for comparison only. This isolated sandbox does not load production code, call APIs, connect to TUIOS, or change real work.

## Launch

Requires [Bun](https://bun.sh/), with no package installation:

```sh
# From the tuios-inbox app root
bun .impeccable/prototypes/list-directions/server.mjs

# Or from this preview directory
bun server.mjs
```

The server binds only to `127.0.0.1`, prints its URL, and defaults to port `4401`. Set `PORT=4402` to use another port. It serves local files with GET/HEAD only and rejects paths or symlinks escaping this directory.

## Directions

- [Flight deck queue](http://127.0.0.1:4401/?variant=flight)
- [Packet capture workbench](http://127.0.0.1:4401/?variant=packet)
- [Bitmap research desk](http://127.0.0.1:4401/?variant=bitmap)
- [Constructed systems grid](http://127.0.0.1:4401/?variant=grid)
- [Familiar developer dashboard](http://127.0.0.1:4401/?variant=dashboard)

The bottom selector, arrow buttons, and Left/Right keyboard arrows switch directions and update the shareable URL. Keyboard arrows are not intercepted while editing inputs, textareas, selects, or editable content. Only the active direction's stylesheet is loaded.

## Interactions and boundaries

Navigate Inbox, Turns, Tasks, Agents, Archive, and Agent profiles. Search matches title, task, agent, kind, and state. Filter unread entries, select individual or all visible rows, expand sample responses, and add synthetic sample work to the active view. The banner shows the selected count.

View, search, unread filter, selection, and expansion persist while changing visual directions. Added sample work exists only in page memory. Reloading restores the original fixtures; only the selected visual direction persists through its URL. Read/unread states are synthetic metadata, not real message status. No work is dispatched, archived, approved, or executed.

## Self-hosted display fonts

Variant-owned assets are served locally, with no browser requests to font services:

- Flight: [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed), weight 600, `flight-barlow-condensed-600.ttf`. [License](fonts/barlow-condensed-OFL.txt).
- Grid: [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch), weight 600, `grid-chakra-petch-600.ttf`. [License](fonts/chakra-petch-OFL.txt).
- Bitmap: [Silkscreen](https://fonts.google.com/specimen/Silkscreen), `fonts/bitmap.ttf`. [License](fonts/silkscreen-OFL.txt).

Other interface text uses operational system sans-serif stacks. These are development-only comparison artifacts, not a production redesign.
