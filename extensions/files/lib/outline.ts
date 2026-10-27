export const OUTLINE_MAX = 150;
const TEXT_MAX = 120;

const RULES: [RegExp, RegExp][] = [
  [/\.(md|markdown)$/i, /^#{1,6}\s/],
  [
    /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i,
    /^\s{0,2}(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function\*?|class|interface|type|enum|const|let|var|namespace)\s+[\w$]+|^\s{2}(public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?(get\s+|set\s+)?[\w$]+\s*\(.*\)\s*(:\s*[^={]+)?\{\s*$/,
  ],
  [/\.py$/i, /^\s*(async\s+)?(def|class)\s+\w+/],
  [/\.(sh|bash|zsh|bats)$/i, /^\s*(function\s+[\w:-]+|[\w:-]+\s*\(\)\s*\{?\s*$|@test\s)/],
  [/\.nix$/i, /^\s{0,4}[\w"${}.-]+\s*=(?!=)/],
  [/\.go$/i, /^(func|type|var|const)\s/],
  [/\.rs$/i, /^\s*(pub(\([\w:]+\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|type|const|static)\b/],
  [/\.ya?ml$/i, /^\s{0,2}[\w"'.-][^:#]*:(\s|$)/],
  [/\.json$/i, /^\s{0,2}"[^"]+"\s*:/],
  [/\.lua$/i, /^\s*(local\s+)?function\s/],
  [/(^|\/)justfile$/i, /^[@\w-][^:=]*:(?!=)/],
  [/\.toml$/i, /^\[/],
];

const indent = (line: string) => line.match(/^\s*/)![0].length;

// Line numbers of the declarations in a file; empty when the file type has no rule.
export function outline(path: string, lines: string[]): { entries: string[]; cut: boolean } {
  const rule = RULES.find(([file]) => file.test(path))?.[1];
  if (!rule) return { entries: [], cut: false };
  let hits = lines.flatMap((line, i) => (rule.test(line) ? [i] : []));
  if (hits.length > OUTLINE_MAX) {
    const top = Math.min(...hits.map((i) => indent(lines[i])));
    hits = hits.filter((i) => indent(lines[i]) === top);
  }
  const cut = hits.length > OUTLINE_MAX;
  const entries = hits.slice(0, OUTLINE_MAX).map((i) => {
    const text = lines[i].trimEnd();
    return `${i + 1}: ${text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text}`;
  });
  return { entries, cut };
}
