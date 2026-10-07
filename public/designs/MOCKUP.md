# tuios inbox design comparison

Open the [comparison page](index.html), the [Mail-first design](inbox.html), or the [Task-first design](tasks.html).

These are interactive UI designs with sample data. They do not dispatch real prompts, subscribe to TUIOS, alter production records, or implement system notifications. Refreshing a preview resets its examples. The existing application is unchanged.

## Mail-first, recommended

The completed-response inbox is the main queue. On desktop, the project navigation, response list, and full reading pane remain visible together. On a phone, opening a response replaces the list, with a Back to list control.

Unread responses have a dot, explicit Unread text, a raised background, and a bold subject. The inbox count and page title also show the unread total. The reading pane includes the full example answer, code blocks, an Original prompt disclosure, and a follow-up composer.

Use this layout when the main question is "What came back while I was away?" Task context is visible on each response, but it does not get between the user and the finished answer.

## Task-first

Tasks lead. Selecting one shows its status, assigned agent, execution state, and correspondence. Completed turns appear as email-like response envelopes. Opening an envelope reveals the full answer and marks it read. A global Inbox collects responses across tasks and projects.

The task stays Awaiting review after the agent finishes. Complete task is a separate user action, available after its responses have been read and no turn is working.

Use this layout when the main question is "What needs to happen next on this task?" The tradeoff is an extra selection before reading a response compared with Mail-first.

## Shared interaction model

```js
{
  task: { id: 'expiry', state: 'awaiting_review' },
  turn: { state: 'finished', agent: 'Codex' },
  response: {
    subject: 'Session expiry fix is ready to review',
    unread: true,
    capture: 'complete',
    body: 'The full completed response...'
  }
}
```

Execution, task status, and read state are independent. A finished turn does not complete its task. A response can be read and still need a follow-up. Historical response senders belong to the response, not the task's current agent assignment.

### Try a prompt

1. Select New prompt in Mail-first or New task in Task-first.
2. Choose an existing task or create a sample task in an existing project. Choose the agent and enter the subject and prompt.
3. Launch demo prompt. The interface shows a working turn, not a completed result.
4. Select Finish next demo turn. This deterministic control stands in for a real turn-completion event. The most recently launched turn finishes first.
5. The response arrives unread. The inbox count, page title, and polite in-page notification update.
6. Select Open response, or open it from the list. Opening marks it read.
7. Send demo follow-up to start another turn in the same task.

The preview starts with one working turn and three unread responses. It includes a completion event whose final response is unavailable. That response explicitly says the completion event is not proof of success and does not fabricate an answer.

### Arrivals do not interrupt reading

A completion does not navigate, auto-open a message, clear a draft, or replace the current reader. Notification remains until dismissed or opened. The explicit demo control replaces a clock-driven simulation; there is no polling or heartbeat.

The previews also provide search, unread or execution-state filters, project filters on desktop, and archive/restore in the shared Inbox. Empty results, disabled controls, and retained drafts on a busy-task submission are included. The dialog uses native browser validation, native selects, and keyboard focus treatment.

No local filesystem path input is introduced. Project selection uses existing sample projects. A real new-project flow must use an OS directory picker rather than a text field alone.

## Real TUIOS integration contract

These designs show the browser-side workflow, not an integration implementation.

- Dispatch to a specific task and native agent/pane. A dispatch acknowledgement means accepted, not finished.
- Receive a turn-completion event and store its response as unread. Do not subscribe to live token output or infer completion from an idle terminal.
- Capture the full final response when the harness provides it. Keep partial, missing, and uncertain captures explicit. A terminal snapshot is not automatically a canonical final answer.
- Use a stable turn identity so reconnecting does not create duplicate mail.
- Keep unread state and task completion independent of TUIOS execution state.
- Preserve the selected response, reader position, and unsent drafts when a new response arrives.
- Browser and operating-system notification permission, tailnet access, and trusted human approvals remain production integration decisions. These previews do not claim to implement them.

## Visual system and files

Both designs inherit the current Flight deck palette and bundled Barlow Condensed headings. They compare composition and navigation rather than replacing the product identity.

- [tokens.css](tokens.css): shared palette, typography, controls, and browser treatments.
- [layouts.css](layouts.css): responsive layouts and correspondence presentation.
- [designs.js](designs.js): sample records and shared demo interactions.
- [index.html](index.html): comparison page with desktop, tablet, and phone viewport controls.
- [inbox.html](inbox.html), [tasks.html](tasks.html): standalone design entry points.

## Preview locally

The production server serves an explicit asset allowlist, so these designs use a separate static preview server.

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory public
```

Open `http://127.0.0.1:8766/designs/index.html`. This command exposes only a local preview; it does not provide tailnet access.
