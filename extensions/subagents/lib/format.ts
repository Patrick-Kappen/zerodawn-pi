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

export interface Done {
  summary: string;
  changes: { file: string; what: string }[];
  tests: { file: string; covers: string }[];
  decisions: string[];
  open: string[];
}

export interface Findings {
  summary: string;
  findings: string[];
}

export interface GateInfo {
  ok: true;
  files: string[];
  tests: string;
}

export function isFindings(data: Done | Findings): data is Findings {
  return "findings" in data;
}

export function doneText(data: Done | Findings, gate: GateInfo): string {
  if (isFindings(data)) return [data.summary, ...data.findings].join("\n");
  return [
    data.summary,
    ...data.changes.map((change) => `${change.file}: ${change.what}`),
    data.tests.length > 0 ? `tests: ${gate.tests}; added: ${data.tests.map((test) => test.file).join(", ")}` : `tests: ${gate.tests}`,
    ...(data.decisions.length > 0 ? [`decisions: ${data.decisions.join("; ")}`] : []),
    ...(data.open.length > 0 ? [`open: ${data.open.join("; ")}`] : []),
  ].join("\n");
}
