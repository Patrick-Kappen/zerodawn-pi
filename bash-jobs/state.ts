import type { Job } from "./jobproc.ts";

export type State = {
  jobs: Map<string, Job>;
  ui: any;
  waiting: Map<string, () => void>;
};

export const createState = (): State => ({ jobs: new Map(), ui: undefined, waiting: new Map() });

export const hasBackgroundJob = (s: State) => [...s.jobs.values()].some((j) => j.bg && !j.result);
