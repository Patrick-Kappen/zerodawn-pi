export interface Profile {
  description: string;
  tools: string[];
  extensions: string[];
  skills: string[];
  checks: string[];
  prompt: string;
}

const LIST_KEYS = ["tools", "extensions", "skills", "checks"] as const;
const KEYS: string[] = ["description", ...LIST_KEYS];
const KEY_LINE = /^([A-Za-z]+):(.*)$/;
const ITEM_LINE = /^\s+-(?:\s+(.*))?$/;

export function parseProfile(text: string, file: string): Profile {
  const fail = (line: number, reason: string): never => {
    throw new Error(`profile ${file}, line ${line}: ${reason}`);
  };
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") fail(1, 'the file must start with a "---" line.');
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
  if (close === -1) fail(lines.length, 'the frontmatter has no closing "---" line.');

  const found = new Map<string, string | string[]>();
  const item = (raw: string | undefined, line: number): string => {
    const value = raw?.trim() ?? "";
    if (value === "") fail(line, "a list item is empty.");
    return value;
  };
  for (let i = 1; i < close; i++) {
    const number = i + 1;
    const current = lines[i] as string;
    if (current.trim() === "") continue;
    const match = KEY_LINE.exec(current);
    if (match === null) {
      fail(number, `expected "key: value", got "${current}".`);
      continue;
    }
    const key = match[1] as string;
    const rest = (match[2] as string).trim();
    if (key === "models") fail(number, 'key "models" is not allowed. Remove it: the model ladder is "subagentModels" in config.json.');
    if (!KEYS.includes(key)) fail(number, `unknown key "${key}". Use: ${KEYS.join(", ")}.`);
    if (found.has(key)) fail(number, `key "${key}" is given twice.`);
    if (key === "description") {
      if (rest === "") fail(number, 'key "description" has no value.');
      found.set(key, rest);
    } else if (rest.startsWith("[")) {
      if (!rest.endsWith("]")) fail(number, `the inline list of "${key}" has no closing "]".`);
      const inner = rest.slice(1, -1).trim();
      found.set(key, inner === "" ? [] : inner.split(",").map((part) => item(part, number)));
    } else if (rest === "") {
      const items: string[] = [];
      while (i + 1 < close) {
        const next = ITEM_LINE.exec(lines[i + 1] as string);
        if (next === null) break;
        i++;
        items.push(item(next[1], i + 1));
      }
      found.set(key, items);
    } else {
      fail(number, `key "${key}" needs a list: "[a, b]" or "- item" lines.`);
    }
  }

  const description = found.get("description");
  if (typeof description !== "string") fail(close + 1, 'key "description" is missing.');
  const prompt = lines
    .slice(close + 1)
    .join("\n")
    .trim();
  if (prompt === "") fail(close + 1, "the prompt text after the frontmatter is empty.");
  const list = (key: string): string[] => (found.get(key) ?? []) as string[];
  return {
    description: description as string,
    tools: list("tools"),
    extensions: list("extensions"),
    skills: list("skills"),
    checks: list("checks"),
    prompt,
  };
}
