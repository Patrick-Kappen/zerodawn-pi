export interface Blocker {
  issue: string;
  files: string[];
  tried: string[];
}

export interface Handoff {
  done: string[];
  open: string[];
  next: string;
  files: string[];
  risks: string[];
  tests: string;
}

export function blockerText(blocker: Blocker): string {
  return [blocker.issue, `files: ${blocker.files.join(", ")}`, `tried: ${blocker.tried.join("; ")}`].join("\n");
}

export function handoffText(handoff: Handoff): string {
  return [
    `done: ${handoff.done.join("; ")}`,
    `open: ${handoff.open.join("; ")}`,
    `next: ${handoff.next}`,
    `files: ${handoff.files.join(", ")}`,
    `risks: ${handoff.risks.join("; ")}`,
    `tests: ${handoff.tests}`,
  ].join("\n");
}
