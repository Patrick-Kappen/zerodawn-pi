export type ChainPart = { text: string; sep: string };

const OPEN = new Set(["if", "for", "while", "until", "case", "select", "{"]);
const CLOSE = new Set(["fi", "done", "esac", "}"]);
const NEXT_IS_COMMAND = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "!", "time"]);

/**
 * Splits a bash command at its top-level `&&`, `||`, `;`, `&` and new lines. A loop, `if`, `case`,
 * `{ }` group, subshell, `$( )` or heredoc stays in one part. Joining `text + sep` of all parts gives
 * the command back. Undefined when a quote, block or heredoc does not close.
 */
export function splitChain(command: string): ChainPart[] | undefined {
  const parts: ChainPart[] = [];
  const heredocs: { delim: string; tabs: boolean }[] = [];
  let start = 0;
  let depth = 0;
  let paren = 0;
  let varBrace = 0;
  let word = "";
  let atCommand = true;
  let i = 0;

  const endWord = () => {
    if (!word) return;
    if (atCommand && OPEN.has(word)) depth++;
    else if (atCommand && CLOSE.has(word)) depth--;
    atCommand = NEXT_IS_COMMAND.has(word);
    word = "";
  };
  const cut = (sep: string) => {
    endWord();
    parts.push({ text: command.slice(start, i), sep });
    i += sep.length;
    start = i;
    atCommand = true;
  };
  const top = () => depth === 0 && paren === 0 && varBrace === 0;

  while (i < command.length) {
    const c = command[i];
    const two = command.slice(i, i + 2);
    if (c === "\\") {
      word += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'" || c === "`") {
      const end = command.indexOf(c, i + 1);
      if (end < 0) return undefined;
      word += command.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') j += command[j] === "\\" ? 2 : 1;
      if (j >= command.length) return undefined;
      word += command.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "#" && !word) {
      const end = command.indexOf("\n", i);
      i = end < 0 ? command.length : end;
      continue;
    }
    if (two === "<<" && command[i + 2] !== "<" && command[i - 1] !== "<") {
      const m = command.slice(i).match(/^<<(-?)\s*(['"]?)([\w.-]+)\2/);
      if (!m) return undefined;
      heredocs.push({ delim: m[3], tabs: m[1] === "-" });
      endWord();
      i += m[0].length;
      continue;
    }
    if (c === "\n" && heredocs.length) {
      endWord();
      let j = i + 1;
      for (const h of heredocs.splice(0)) {
        for (;;) {
          if (j >= command.length) return undefined;
          const nl = command.indexOf("\n", j);
          const line = command.slice(j, nl < 0 ? command.length : nl);
          j = nl < 0 ? command.length : nl + 1;
          if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.delim) break;
        }
      }
      // The body belongs to the line that opened it; the new line after the delimiter separates.
      if (command[j - 1] !== "\n") {
        i = command.length;
        break;
      }
      i = j - 1;
      continue;
    }
    if (two === "${") {
      varBrace++;
      word += two;
      i += 2;
      continue;
    }
    if (c === "}" && varBrace > 0) {
      varBrace--;
      word += c;
      i++;
      continue;
    }
    if (c === "(") {
      endWord();
      paren++;
      i++;
      atCommand = true;
      continue;
    }
    if (c === ")") {
      endWord();
      // A case pattern such as "a)" has no "(": do not go below zero.
      paren = Math.max(0, paren - 1);
      i++;
      continue;
    }
    // A word such as "fi" in "fi;" closes its block before the separator counts.
    if (c === ";" || c === "&" || c === "|" || c === "\n") endWord();
    if (top() && (two === "&&" || two === "||")) {
      cut(two);
      continue;
    }
    if (top() && (c === ";" || c === "\n") && two !== ";;") {
      cut(c);
      continue;
    }
    if (top() && c === "&" && command[i - 1] !== ">" && command[i - 1] !== "|" && command[i + 1] !== ">") {
      cut(c);
      continue;
    }
    if (/\s/.test(c) || c === ";" || c === "|" || c === "&" || c === "<" || c === ">") {
      endWord();
      if (c === "|" || c === ";" || c === "&" || c === "\n") atCommand = true;
      i++;
      continue;
    }
    word += c;
    i++;
  }
  endWord();
  if (depth !== 0 || paren !== 0 || varBrace !== 0 || heredocs.length) return undefined;
  parts.push({ text: command.slice(start), sep: "" });
  return parts;
}
