export type Diagnostic = { lnum: number; col: number; source?: string | null; message: string };

/** The message after a successful run: only errors, one line per diagnostic, with a location that an editor can open. */
export function formatDiagnostics(file: string, diagnostics: Diagnostic[]): string {
  const lines = diagnostics.map((d) => {
    const where = `${file}:${d.lnum}:${d.col}`;
    return d.source ? `${where} ${d.source}: ${d.message}` : `${where} ${d.message}`;
  });
  return `LSP errors after the edit of ${file}:\n${lines.join("\n")}`;
}

export const conflict = (file: string) => `${file} has unsaved changes in nvim; LSP check skipped`;

export const noResult = (file: string) => `LSP gave no result for ${file} in 15 s`;

export const noServer = (socket: string) => `nvim server ${socket} is missing and did not appear within 5 s after starting nvim@main.service`;

export const noEnv = "PI_NVIM_SERVER is not set; LSP checks are off.";
