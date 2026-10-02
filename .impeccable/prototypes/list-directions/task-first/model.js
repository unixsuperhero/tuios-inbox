const at = time => `2026-10-02T${time}:00.000Z`;
const terminal = turn => ['complete', 'needs_input', 'error'].includes(turn.status);
const pending = turn => terminal(turn) && Boolean(turn.completedAt) && turn.reviewedAt === null;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const completionOrder = (a, b) => compareText(a.completedAt, b.completedAt) || compareText(a.id, b.id);
const historyOrder = (a, b) => a.sequence - b.sequence || compareText(a.id, b.id);

const retryFinding = [
  'Synthetic sample response. This is a written scenario for comparing the inbox layouts; no repository was inspected, no agent ran, and no test results are being reported.',
  'The proposed sign-in retry flow needs a limit that belongs to one sign-in attempt. Imagine someone submitting their credentials while the connection is unreliable. The first request starts an attempt. A temporary failure can schedule another request, but repeated failures should eventually return control to the person with a clear explanation.',
  'For this sample, the suggested limit is three requests in total: the initial request and at most two retries. Calling the limit “three retries” would describe four requests, so the interface and implementation should use the same wording. The exact number is a product decision in this fictional example, rather than a measured recommendation.',
  'The attempt should keep its request count together with its cancellation state. That makes the important question straightforward: may this attempt send another request? The answer depends on both the number already sent and whether the person has abandoned the attempt. Keeping those facts together also makes it easier to explain why the flow stopped.',
  'A retry should be considered only for an explicitly temporary failure. Incorrect credentials need a useful correction message immediately. Retrying the same credentials without a change would leave the person waiting without helping them complete sign-in. This distinction is part of the sample design, not a finding about the current application.',
  'While a retry is waiting, the sign-in screen should explain that it will try again. A cancel action should end the attempt and prevent another request from being scheduled. If the person changes their credentials and submits again, that submission begins a separate attempt with its own count. It must not inherit the previous attempt’s remaining retries.',
  'Consider the following illustrative sequence. The initial request encounters a temporary connection failure. A second request is scheduled and also fails. The third request fails in the same way, so the attempt ends with a message inviting the person to try again. There is no fourth request attached to that attempt. These are invented events used to make the proposed boundary concrete.',
  'An eventual success needs the same ownership rule. If an earlier attempt was cancelled and its response arrives after a new attempt begins, that old response must not replace the new attempt’s state. The visible screen should follow the current attempt. This sample calls out the relationship because it is easy to lose when request timing and interface state are described separately.',
  'The exhausted state should preserve the person’s useful input where appropriate and explain what they can do next. A short message such as “We could not connect. Try again when your connection is ready” communicates a different problem from a credentials error. The final wording would need review in the real product; the wording here is only sample content.',
  'Suggested verification cases for a future implementation include success on the initial request, success on the last allowed request, exhaustion of the request limit, cancellation during the waiting period, and a new submission after exhaustion. Each case should observe requests and visible state together. No such checks have been executed for this prototype.',
  'A separate turn in this same Retry review thread covers cancellation in more detail. Its review state is independent of this response. Marking this finding reviewed should remove only this finding from the global queue while leaving the later cancellation finding available. Both turns should remain accessible in the thread’s history.',
  'The next useful decision is whether the sample’s three-request vocabulary is understandable enough to carry into a real design discussion. Reviewing this response records that it has been read in the prototype. It does not approve an implementation, run a command, or start work. A reply creates a new synthetic working turn in this thread.',
].join('\n\n');

/** A fresh normalized fixture and its independent, resettable UI state. */
export function createScenario() {
  const tasks = [
    ['auth', 'Fix sign-in retry'],
    ['search', 'Speed up search'],
    ['inbox', 'Task-first inbox'],
    ['capture', 'Repair turn capture'],
    ['ci', 'Stabilize CI'],
    ['keyboard', 'Keyboard navigation'],
    ['setup', 'Simplify agent setup'],
    ['index', 'Index repositories'],
    ['docs', 'Explain capture sources'],
    ['export', 'Export review notes'],
  ].map(([id, title]) => ({ id, title }));
  const agents = [
    ['auth-builder', 'auth', 'Builder'],
    ['auth-reviewer', 'auth', 'Reviewer'],
    ['search-profiler', 'search', 'Profiler'],
    ['search-reviewer', 'search', 'Query reviewer'],
    ['inbox-interface', 'inbox', 'Interface'],
    ['inbox-visual', 'inbox', 'Visual reviewer'],
    ['capture-tracer', 'capture', 'Tracer'],
    ['ci-runner', 'ci', 'Test runner'],
    ['keyboard-auditor', 'keyboard', 'Auditor'],
    ['setup-designer', 'setup', 'Designer'],
    ['index-scanner', 'index', 'Scanner'],
    ['docs-writer', 'docs', 'Writer'],
  ].map(([id, taskId, name]) => ({
    id, taskId, name,
    availability: id === 'index-scanner' ? 'offline' : 'online',
    pane: { session: 'sample-work', id: `sample-pane-${id}` },
  }));
  const threadDefinitions = {
    'auth-builder': [['auth-builder-thread', 'Retry implementation']],
    'auth-reviewer': [['auth-review', 'Retry review'], ['auth-session', 'Session expiry']],
    'search-profiler': [['search-profiler-thread', 'Search profiling']],
    'search-reviewer': [['search-reviewer-thread', 'Search index review']],
    'inbox-interface': [['inbox-layout', 'Layout'], ['inbox-keyboard', 'Keyboard behavior']],
    'inbox-visual': [['inbox-visual-thread', 'Task expansion']],
    'capture-tracer': [['capture-tracer-thread', 'Capture trace']],
    'ci-runner': [['ci-runner-thread', 'CI stability']],
    'keyboard-auditor': [['keyboard-auditor-thread', 'Keyboard order']],
    'setup-designer': [['setup-designer-thread', 'Setup labels']],
    'index-scanner': [['index-scanner-thread', 'Repository index']],
    'docs-writer': [['docs-writer-thread', 'Capture sources']],
  };
  const threads = agents.flatMap(agent => threadDefinitions[agent.id].map(([id, title]) => ({ id, agentId: agent.id, title })));
  const turns = threads.map((thread, index) => ({
    id: `history-${thread.id}`, threadId: thread.id, sequence: 1,
    title: `${thread.title} starting point`,
    prompt: `Summarize a sample starting point for ${thread.title.toLowerCase()}.`,
    response: `Synthetic reviewed history for ${thread.title.toLowerCase()}. The initial discussion established the scope and vocabulary for the next turn. No real work or checks were performed.`,
    status: 'complete', startedAt: at('08:30'),
    completedAt: at(`08:${String(40 + index).padStart(2, '0')}`), reviewedAt: at('08:58'),
  }));
  const addTurn = turn => {
    const sequence = 1 + Math.max(0, ...turns.filter(item => item.threadId === turn.threadId).map(item => item.sequence));
    turns.push({ ...turn, sequence });
  };
  const reviews = [
    ['review-1', 'auth-review', '09:02', 'Retry limit finding', 'complete', 'Review the retry limit for this sample sign-in flow.', retryFinding],
    ['review-2', 'search-reviewer-thread', '09:06', 'Search index result', 'complete', 'Describe a possible search index change.', 'Synthetic search review. A proposed index could keep searchable text next to the item identifier and refresh it when the item changes.\n\nThis example includes no measured timings or executed benchmarks. A future check would compare the same query and dataset before and after a real change.'],
    ['review-3', 'auth-review', '09:11', 'Retry cancellation finding', 'complete', 'Review cancellation separately from the retry limit.', 'Synthetic cancellation finding. Cancelling a sign-in attempt should stop its scheduled retry and prevent a late response from replacing a newer attempt.\n\nThis is a separate finding from the retry limit turn. Reviewing either turn leaves the other turn’s review state intact. No implementation was inspected or changed.'],
    ['review-4', 'inbox-visual-thread', '09:14', 'Which task stays expanded?', 'needs_input', 'Ask one question about the task expansion behavior.', 'Synthetic design question: when a response opens, should its task remain expanded after returning to the global queue?\n\nThe sample favors retaining the expanded task so its agents and threads stay easy to find. Reply with the behavior you prefer. This is a finished question, not an authorization request; marking it reviewed does not start work.'],
    ['review-5', 'keyboard-auditor-thread', '09:19', 'Keyboard order finding', 'complete', 'Describe a sample keyboard navigation check.', 'Synthetic keyboard finding. The intended tab order follows task selection, agent selection, thread selection, and then the prompt. Queue entries remain individually reachable.\n\nArrow keys inside a textarea or native selection control should keep their normal behavior. These are proposed checks, not results from a real accessibility audit.'],
    ['review-6', 'docs-writer-thread', '09:23', 'Capture-source draft stopped', 'error', 'Draft a short explanation of capture sources.', 'Synthetic stopped draft. The sample writer could not finish the capture-source explanation because its example source description was incomplete.\n\nThe partial outline distinguishes a turn’s prompt, its response, and the execution details beneath its agent. No source was read and no real process failed. A new prompt or reply can continue this fictional discussion.'],
  ];
  for (const [id, threadId, time, title, status, prompt, response] of reviews) {
    addTurn({ id, threadId, title, prompt, response, status, startedAt: at('09:00'), completedAt: at(time), reviewedAt: null });
  }
  const workingAgents = ['auth-builder', 'search-profiler', 'inbox-interface', 'capture-tracer', 'ci-runner'];
  workingAgents.forEach((agentId, index) => {
    const thread = threads.find(item => item.agentId === agentId);
    addTurn({
      id: `working-${agentId}`, threadId: thread.id, title: `${thread.title} follow-up`,
      prompt: `Continue the synthetic ${thread.title.toLowerCase()} discussion.`,
      response: null, status: 'working', startedAt: at(`09:${24 + index}`), completedAt: null, reviewedAt: null,
    });
  });
  return {
    data: { clock: at('09:30'), nextId: 100, tasks, agents, threads, turns },
    ui: {
      variant: 'ledger', taskId: null, agentId: null, threadId: null, openTurnId: null,
      expandedTaskIds: ['auth'], expandedAgentIds: [], queueOrder: 'oldest', drafts: {},
      composerTaskId: '', composerAgentId: '', composerThreadId: '', composerSubject: '',
      composerShown: false, failNextSend: false, mobileView: 'tasks',
    },
  };
}

function ageLabel(clock, timestamp) {
  const minutes = Math.max(0, Math.floor((Date.parse(clock) - Date.parse(timestamp)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

/** Derivations never mutate fixture/UI state; shallow raw parents keep the graph acyclic. */
export function deriveModel(data, ui) {
  const rawTasks = new Map(data.tasks.map(task => [task.id, task]));
  const rawAgents = new Map(data.agents.map(agent => [agent.id, agent]));
  const rawThreads = new Map(data.threads.map(thread => [thread.id, thread]));
  const turns = data.turns.map(turn => {
    const thread = rawThreads.get(turn.threadId);
    const agent = rawAgents.get(thread?.agentId);
    const task = rawTasks.get(agent?.taskId);
    return {
      ...turn,
      thread: thread ? { ...thread } : null,
      agent: agent ? { ...agent } : null,
      task: task ? { ...task } : null,
      age: ageLabel(data.clock, turn.completedAt || turn.startedAt),
      label: turn.title || `Turn ${turn.sequence}`,
    };
  });
  const threads = data.threads.map(thread => {
    const threadTurns = turns.filter(turn => turn.threadId === thread.id).sort(historyOrder);
    return { ...thread, turns: threadTurns, pendingCount: threadTurns.filter(pending).length };
  });
  const agents = data.agents.map(agent => {
    const agentThreads = threads.filter(thread => thread.agentId === agent.id);
    const agentTurns = agentThreads.flatMap(thread => thread.turns);
    const newestTerminal = agentTurns.filter(turn => terminal(turn) && turn.completedAt).sort(completionOrder).at(-1);
    const status = agent.availability === 'offline' ? 'offline'
      : agentTurns.some(turn => turn.status === 'working') ? 'working'
      : ['needs_input', 'error'].includes(newestTerminal?.status) ? newestTerminal.status : 'idle';
    return { ...agent, threads: agentThreads, turns: agentTurns, status, pendingCount: agentTurns.filter(pending).length };
  });
  const tasks = data.tasks.map(task => {
    const taskAgents = agents.filter(agent => agent.taskId === task.id);
    return {
      ...task, agents: taskAgents,
      workingCount: taskAgents.filter(agent => agent.status === 'working').length,
      pendingCount: taskAgents.reduce((count, agent) => count + agent.pendingCount, 0),
      threadCount: taskAgents.reduce((count, agent) => count + agent.threads.length, 0),
    };
  });
  const queue = turns.filter(pending).sort(completionOrder);
  if (ui.queueOrder === 'newest') queue.reverse();
  const find = (items, id) => items.find(item => item.id === id) || null;
  const task = find(tasks, ui.taskId);
  const agent = find(task?.agents || [], ui.agentId);
  const thread = find(agent?.threads || [], ui.threadId);
  const openTurn = find(turns, ui.openTurnId);
  const composerTask = find(tasks, ui.composerTaskId);
  const composerAgent = find(composerTask?.agents || [], ui.composerAgentId);
  const composerThread = find(composerAgent?.threads || [], ui.composerThreadId);
  return {
    data, ui, tasks, agents, threads, turns, queue,
    counts: {
      tasks: tasks.length, agents: agents.length,
      workingTasks: tasks.filter(task => task.workingCount > 0).length,
      workingAgents: agents.filter(agent => agent.status === 'working').length,
      pending: queue.length,
    },
    task, agent, thread, openTurn, composerTask, composerAgent, composerThread,
    promptDraftKey: `prompt:${ui.composerTaskId}:${ui.composerAgentId}:${ui.composerThreadId}`,
    replyDraftKey: `reply:${ui.openTurnId || ''}`,
  };
}
