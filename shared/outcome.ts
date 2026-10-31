import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The channel where an extension tells core that work starts which keeps the run open. */
export const WORK_START = "core:work-start";
/** The channel where an extension tells core that the agent got the report of the work. */
export const WORK_END = "core:work-end";
/** The channel where an extension tells core the result of one stage at the end of a run. */
export const STAGE_RESULT = "core:stage-result";

/** The kinds of work that keep a run open. */
export const WORK_KINDS = ["bash", "tests", "lsp", "opencode", "subagent"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** One unit of open work. `id` is unique within its kind. `label` tells the user what runs. */
export type Work = { kind: WorkKind; id: string; label: string };
export type WorkRef = Pick<Work, "kind" | "id">;

/** The stages at the end of a run, in their order. `lint` is lint and types in one stage. */
export const STAGES = ["format", "lint", "tests", "checker"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The result of one stage. `state` names the file state that the stage saw: the same string means the same files.
 * A failed stage has the report for the agent.
 */
export type StageResult = { stage: Stage; state: string; passed: true } | { stage: Stage; state: string; passed: false; report: string };

type Events = Pick<ExtensionAPI, "events">;

function need(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is empty`);
}

/** Tells core that work starts. Emit workEnd for the same kind and id after the agent gets its report. */
export function workStart(pi: Events, work: Work): void {
  need(work.id, `${work.kind} work id`);
  need(work.label, `${work.kind} work ${work.id}: label`);
  pi.events.emit(WORK_START, work);
}

/** Tells core that the agent got the report of the work. */
export function workEnd(pi: Events, work: WorkRef): void {
  need(work.id, `${work.kind} work id`);
  pi.events.emit(WORK_END, { kind: work.kind, id: work.id });
}

/** Calls `start` and `end` for each workStart and workEnd. */
export function onWork(pi: Events, handlers: { start: (work: Work) => void; end: (work: WorkRef) => void }): void {
  pi.events.on(WORK_START, (data) => handlers.start(data as Work));
  pi.events.on(WORK_END, (data) => handlers.end(data as WorkRef));
}

/** Tells core the result of one stage. */
export function stageResult(pi: Events, result: StageResult): void {
  need(result.state, `${result.stage} stage: state`);
  if (!result.passed) need(result.report, `failed ${result.stage} stage: report`);
  pi.events.emit(STAGE_RESULT, result);
}

/** Calls `handler` for each stageResult. */
export function onStageResult(pi: Events, handler: (result: StageResult) => void): void {
  pi.events.on(STAGE_RESULT, (data) => handler(data as StageResult));
}
