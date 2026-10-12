# Task-first outline prototype

Clickable mock of [the task-first outline brief](../../planning/task-first-outline.md). Synthetic data, all in page memory, reset on reload. Not production code.

```sh
bun .impeccable/prototypes/task-first-outline/server.mjs      # http://127.0.0.1:4403/
PORT=4410 bun .impeccable/prototypes/task-first-outline/server.mjs
```

- `model.js`: fixtures plus pure logic (inheritance, preflight, queue tick, outline rows).
- `outline.js`: rendering and interaction.
- Keys: `n` or `/` capture, `j`/`k` or arrows move, left/right collapse and expand, `Tab`/`Shift+Tab` re-parent a task, `Enter` open.
- Capture: plain text is a task, `> text` is a prompt saved to the queue, Cmd/Ctrl+Enter on a `>` line tries Run now.
- Browse uses `window.showDirectoryPicker` (falls back to a directory file input). A browser only reveals the folder name, so the mock fills in the name, not a full path.
