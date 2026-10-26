export interface SupervisorArgs {
  session: string;
  dir: string;
  id: string;
  pi: string;
  extensions: string[];
}

const SESSION = /^pi-sub-([A-Za-z0-9-]{8})$/;
const DIR = /^\/tmp\/pi-sub-([A-Za-z0-9-]{8})$/;
const USAGE = "Usage: supervisor.ts --session pi-sub-<id> --dir /tmp/pi-sub-<id> --pi <command> --extension <absolute path> [--extension <absolute path> ...]";

const NAMES = ["--session", "--dir", "--pi", "--extension"];

export function parseArgs(argv: string[]): SupervisorArgs {
  const values = new Map<string, string>();
  const extensions: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!NAMES.includes(name as string)) {
      throw new Error(`supervisor: unknown argument "${name}". ${USAGE}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`supervisor: argument ${name} has no value. ${USAGE}`);
    }
    if (name === "--extension") {
      extensions.push(value);
      continue;
    }
    if (values.has(name)) throw new Error(`supervisor: argument ${name} is given twice. ${USAGE}`);
    values.set(name, value);
  }
  const session = values.get("--session");
  const dir = values.get("--dir");
  if (session === undefined) throw new Error(`supervisor: argument --session is missing. ${USAGE}`);
  if (dir === undefined) throw new Error(`supervisor: argument --dir is missing. ${USAGE}`);
  const pi = values.get("--pi");
  if (pi === undefined) throw new Error(`supervisor: argument --pi is missing. ${USAGE}`);
  if (extensions.length === 0) throw new Error(`supervisor: argument --extension is missing. ${USAGE}`);
  for (const extension of extensions) {
    if (!extension.startsWith("/")) throw new Error(`supervisor: extension path "${extension}" is not absolute. ${USAGE}`);
  }
  const sessionMatch = SESSION.exec(session);
  if (sessionMatch === null) throw new Error(`supervisor: session "${session}" is not valid. ${USAGE}`);
  const dirMatch = DIR.exec(dir);
  if (dirMatch === null) throw new Error(`supervisor: directory "${dir}" is not valid. ${USAGE}`);
  if (dirMatch[1] !== sessionMatch[1]) {
    throw new Error(`supervisor: session "${session}" and directory "${dir}" have different ids. ${USAGE}`);
  }
  return { session, dir, id: sessionMatch[1] as string, pi, extensions };
}
