const row = (id,title,kind,state,agent,task,time,unread,response) => ({id,title,kind,state,agent,task,time,unread,response,source:'Local prototype fixture / synthetic workspace'});
export const fixtures = {
  inbox: [
    row('in-1','Choose how the retry queue should drain','Decision','needs_input','Queue scout','Retry queue redesign','2m ago',true,'Two sample approaches are ready: drain oldest work first, or prioritize work waiting on user input. Choose a policy before the fictional patch proceeds.'),
    row('in-2','Tracing the dropped terminal update','Investigation','working','Event tracer','Terminal event delivery','5m ago',true,'The sample investigation is following event delivery from the session buffer to the rendered terminal. No real process has been inspected.'),
    row('in-3','Keyboard navigation patch is ready','Review','done','UI builder','Inbox keyboard controls','12m ago',true,'The fictional patch keeps selection stable when rows are expanded and gives every action a keyboard focus target. Review the sample summary before accepting.'),
    row('in-4','Fixture import could not resolve a path','Failure','error','Fixture runner','Preview data import','18m ago',true,'A synthetic fixture references a path outside its sample directory. The fictional run stopped without importing data. Correct the sample path before retrying.'),
    row('in-5','Confirm the archive retention rule','Decision','needs_input','Archive guide','Archive policy','24m ago',false,'The sample policy retains completed work until manually archived. Confirm whether archived entries should remain searchable.'),
    row('in-6','Indexing the agent handoff notes','Work update','working','Context mapper','Agent handoff map','31m ago',false,'The fictional agent is grouping handoff notes by task and identifying decisions that still need a human response.'),
    row('in-7','Search now includes task and agent names','Result','done','Search builder','Inbox search','44m ago',true,'The sample search matches titles, task names, agent names, kinds, and states. Try searching for “queue” or “done” in this prototype.'),
    row('in-8','Permission review needs an owner','Handoff','needs_input','Boundary reviewer','Tool permissions','1h ago',true,'The synthetic review leaves write access disabled until an owner approves the intended scope. No real permissions are requested or changed.'),
    row('in-9','Session recovery sketch is complete','Result','done','Recovery planner','Session recovery','2h ago',false,'The fictional recovery plan restores visible work first, then rebuilds task context. It is a sample design note, not an executed recovery.'),
    row('in-10','Sample agent connection timed out','Failure','error','Relay watcher','Agent relay','3h ago',false,'The synthetic relay did not receive a response. The fictional request is paused rather than silently marked successful.'),
  ],
  turns: [
    row('tu-1','Queue scout asks for a drain policy','Question','needs_input','Queue scout','Retry queue redesign','2m ago',true,'Sample turn: “Should retries follow arrival order or urgency?” The next step waits for a decision.'),
    row('tu-2','Event tracer follows a delivery boundary','Tool summary','working','Event tracer','Terminal event delivery','5m ago',false,'Sample turn: trace the buffer boundary and compare the emitted event with the visible row state.'),
    row('tu-3','UI builder summarizes the keyboard patch','Response','done','UI builder','Inbox keyboard controls','12m ago',true,'Sample turn: navigation, expansion, and selection are described as separate keyboard actions.'),
    row('tu-4','Fixture runner reports a blocked import','Tool summary','error','Fixture runner','Preview data import','18m ago',false,'Sample turn: import stopped at the directory boundary; no sample records were changed.'),
  ],
  tasks: [
    row('ta-1','Retry queue redesign','Task','needs_input','Queue scout','Retry queue redesign','2m ago',true,'Synthetic task: decide ordering, then draft the queue behavior. The current decision remains open.'),
    row('ta-2','Terminal event delivery','Task','working','Event tracer','Terminal event delivery','5m ago',false,'Synthetic task: map event delivery and identify where a visible update may be lost.'),
    row('ta-3','Inbox keyboard controls','Task','done','UI builder','Inbox keyboard controls','12m ago',true,'Synthetic task: a reviewable keyboard interaction summary is ready.'),
    row('ta-4','Preview data import','Task','error','Fixture runner','Preview data import','18m ago',true,'Synthetic task: a path issue blocks the fixture import. The sample run has stopped.'),
    row('ta-5','Tool permissions','Task','needs_input','Boundary reviewer','Tool permissions','1h ago',false,'Synthetic task: identify the owner and agree on the minimum write scope.'),
  ],
  agents: [
    row('ag-1','Queue scout','Agent','needs_input','Queue scout','Retry queue redesign','2m ago',true,'Synthetic agent assigned to queue behavior. Waiting for the drain-policy decision.'),
    row('ag-2','Event tracer','Agent','working','Event tracer','Terminal event delivery','5m ago',false,'Synthetic agent investigating session events. No live process is connected.'),
    row('ag-3','UI builder','Agent','done','UI builder','Inbox keyboard controls','12m ago',false,'Synthetic agent has left a sample result for review.'),
    row('ag-4','Fixture runner','Agent','error','Fixture runner','Preview data import','18m ago',true,'Synthetic agent stopped at an invalid fixture path.'),
  ],
  archive: [
    row('ar-1','Old session layout comparison','Archived result','done','Layout scout','Session layout','Yesterday',false,'Synthetic archived note comparing a split terminal layout with a single active pane.'),
    row('ar-2','Completed handoff checklist','Archived result','done','Context mapper','Handoff checklist','Yesterday',false,'Synthetic archived checklist: task goal, latest decision, and next action.'),
    row('ar-3','Retired connection probe','Archived failure','error','Relay watcher','Connection probe','2 days ago',false,'Synthetic archived failure preserved for context. No connection was attempted.'),
  ],
  profiles: [
    row('pr-1','Careful reviewer','Profile','done','Boundary reviewer','Read-only review profile','Sample profile',false,'Synthetic profile: inspect proposed changes, name risks, and stop before any write action.'),
    row('pr-2','Focused builder','Profile','done','UI builder','Focused build profile','Sample profile',false,'Synthetic profile: work on one agreed task and present a reviewable result. This is descriptive fixture data only.'),
    row('pr-3','Context scout','Profile','done','Context mapper','Context mapping profile','Sample profile',false,'Synthetic profile: collect task context and identify open decisions before work begins.'),
  ],
};
