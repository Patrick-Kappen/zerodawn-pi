import type { Job } from "./jobproc.ts";

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
