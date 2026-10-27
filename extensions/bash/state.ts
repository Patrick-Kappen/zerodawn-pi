import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Job } from "./tool/jobproc.ts";

export type State = {
  jobs: Map<string, Job>;
  ui: any;
  tui?: { requestRender: () => void };
  follow?: string;
  followEntries: Map<string, number>;
  waiting: Map<string, () => void>;
};

export const createState = (): State => ({ jobs: new Map(), ui: undefined, waiting: new Map(), followEntries: new Map() });

export const hasBackgroundJob = (s: State) => [...s.jobs.values()].some((j) => j.bg && !j.result);

export const BACKGROUND_JOBS_QUERY = "bash:background-jobs";

/** Other extensions emit `{ running: false }` on this channel; the handler sets `running` synchronously. */
export function registerJobsQuery(pi: Pick<ExtensionAPI, "events">, s: State) {
  pi.events.on(BACKGROUND_JOBS_QUERY, (query) => {
    const q = query as { running?: boolean };
    q.running = q.running === true || hasBackgroundJob(s);
  });
}
