export interface Blocker {
  issue: string;
  files: string[];
  tried: string[];
}

export interface Handoff {
  summary: string;
  changes: { file: string; what: string }[];
  tests: { file: string; covers: string }[];
  findings: string[];
  decisions: string[];
  open: string[];
  next: string;
  risks: string[];
}

export function blockerText(blocker: Blocker): string {
  return [blocker.issue, `files: ${blocker.files.join(", ")}`, `tried: ${blocker.tried.join("; ")}`].join("\n");
}

export interface GateInfo {
  ok: true;
  files: string[];
  tests: string;
}

export function handoffText(data: Handoff, gate?: GateInfo, reason?: string): string {
  const tests =
    gate === undefined ? undefined : `tests: ${gate.tests}${data.tests.length > 0 ? `; added: ${data.tests.map((test) => test.file).join(", ")}` : ""}`;
  return [
    data.summary,
    ...data.changes.map((change) => `${change.file}: ${change.what}`),
    ...data.findings,
    ...(tests === undefined ? [] : [tests]),
    ...(reason === undefined ? [] : [`gate red: ${reason}`]),
    ...(data.decisions.length > 0 ? [`decisions: ${data.decisions.join("; ")}`] : []),
    ...(data.open.length > 0 ? [`open: ${data.open.join("; ")}`] : []),
    ...(data.next !== "" ? [`next: ${data.next}`] : []),
    ...(data.risks.length > 0 ? [`risks: ${data.risks.join("; ")}`] : []),
  ].join("\n");
}
