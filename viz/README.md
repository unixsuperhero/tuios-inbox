# Spatial inbox prototype

Two 3D views of the live tuios inbox, built with the `3dviz-pro-max` skill's Vite + three scaffold
and rigs. They read the same `/api/state` the workbench uses and act through the same endpoints, so
marking reviewed, archiving, replying and answering a blocked agent are real writes.

## Run

```sh
cd viz && pnpm install && pnpm build   # output in viz/dist
h tuios start                          # or bun start
open http://127.0.0.1:4399/viz/
```

`server.mjs` serves `viz/dist` under `/viz/` on its own origin, so the API's Host, Origin and
same-origin JSON checks pass unchanged. For live editing, `pnpm dev` on :4173 proxies `/api` to
:4399 and rewrites the Origin header.

Deep links: `?scene=river&hours=168`, `?item=turn:<id>` or `?item=thread:<id>`.

## The question the first view answers

"What finished while I was away." The page stores the time it was last visible in `localStorage`.
Finished, unread records newer than that are the headline count, the lime cards and slabs, and the
list in the panel. Marking a record reviewed removes it from all three. On a first visit every
unread finished record counts.

## Scenes

**Studio pedestals** (`scenes/pedestals.js`). One pedestal per task plus one for unassigned panes,
under the dark studio rig (`knowledge.lighting-mood-dark-studio-product`, scaled x4).

| Channel | Encodes |
| --- | --- |
| Stack height | unread finished records (capped at 40, `+N more` label) |
| Lime card, rose or amber tint | finished and unread; failed; partial / uncertain / snapshot |
| Grey plate thickness | reviewed records |
| Green orb above the stack | work in progress |
| Capsules on the base ring | live panes, coloured by execution state |
| Amber flag | agent waiting for a human |
| Spot brightness | needs input > unread backlog > working > quiet |

**Time river** (`scenes/river.js`). Time runs left to right into a translucent "now" wall; each task
is a lane. Finished unread records float above the lane and glow, reviewed ones lie flat, and work
in progress sits at the wall. An amber plane marks when you last looked. Window: 6h, 24h, 7d, all.

## Interaction

Hover shows a tooltip. Click a card, slab, agent or pedestal to select it: the camera tweens to it,
a lime wire box marks it, and the panel shows the prompt and response (turns) or the message thread,
with Mark reviewed, Archive, Peek at pane, and a composer. A turn's composer queues to the agent pane
and the result arrives as a new turn; a thread's composer replies in the thread. When the record's
agent is in `needs_input` the panel fetches the prompt and offers approve, deny, choose and text
answers, which go through `/api/agents/:id/answer` and still require the server pane's `respond`
grant. Escape clears the selection.

Live updates come from `/api/events`. The scene is rebuilt under the same camera; the selection
follows its id and the panel, including a typed draft, is never re-rendered by a refresh.

## Verified

`scripts/capture.py` from the skill (Playwright, ANGLE Metal) captured every named view of both
scenes with no console or page errors; frames and `capture-log.json` are in `captures/NN-*`.
A deep-linked unread thread showed the selection marker and the panel's detail and actions.
The write actions (mark reviewed, archive, reply, answer) were not exercised against live panes in
that run. `bun test` passes with the new server route.

## Not done

- No bloom: labels are canvas textures and must stay crisp. Vignette only.
- Text in the scene is a pointer, not a reading surface; the panel does the reading.
- The river shows at most the chosen window; older records are not summarised.
- Mobile layout stacks the canvas over the panel but has not been inspected on a phone.
