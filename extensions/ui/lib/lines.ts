const LINE_START = /^((?:\x1b\][^\x07]*\x07)*)((?:\x1b\[[0-9;]*m)*)( ?)/;

export function plainText(line: string): string {
  return line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

export function withLead(line: string, lead: string): string {
  return line.replace(LINE_START, (_all, osc: string, sgr: string, pad: string) =>
    sgr && pad ? `${osc} ${lead.slice(0, -1)}${sgr}${pad}` : `${osc} ${lead}${sgr}`,
  );
}
