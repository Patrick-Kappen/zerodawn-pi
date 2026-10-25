import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyToggle, type Env, findRow, loadRows, type Row, readSettings, type Scope, settingsPath, toggle } from "./settings.ts";

let root: string;
let env: Env;

const put = (path: string, content = "x") => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};
const setSettings = (scope: Scope, value: unknown) => put(settingsPath(scope, env), JSON.stringify(value, null, 2));
const row = (name: string, origin?: string): Row => {
  const found = loadRows(env).rows.filter((r) => r.name === name && (origin === undefined || r.origin === origin));
  expect(found.length).toBe(1);
  return found[0];
};
const settings = (scope: Scope) => readSettings(scope, env);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ext-switch-"));
  env = { agentDir: join(root, "agent"), cwd: join(root, "proj"), selfDir: join(root, "pkg", "ext-switch") };
  mkdirSync(env.agentDir, { recursive: true });
  mkdirSync(env.cwd, { recursive: true });
  put(join(env.agentDir, "extensions", "loose.ts"));
  put(join(env.agentDir, "extensions", "dirext", "index.ts"));
  put(join(env.agentDir, "skills", "dummy", "SKILL.md"));
  put(join(env.agentDir, "prompts", "pr.md"));
  put(join(env.agentDir, "themes", "x.json"));
  put(join(env.cwd, ".pi", "extensions", "plocal.ts"));
  put(join(root, "pkg", "package.json"), JSON.stringify({ name: "zpkg", pi: { extensions: ["*/index.ts", "top.ts"], prompts: ["prompts"] } }));
  put(join(root, "pkg", "a", "index.ts"));
  put(join(root, "pkg", "b", "index.ts"));
  put(join(root, "pkg", "top.ts"));
  put(join(root, "pkg", "ext-switch", "index.ts"));
  put(join(root, "pkg", "prompts", "p1.md"));
  put(join(root, "pkg", "prompts", "p2.md"));
  put(join(root, "pkg", "skills", "s1", "SKILL.md"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("discovery", () => {
  test("lists loose resources, built-ins and package resources by group", () => {
    setSettings("user", { packages: [join(root, "pkg")] });
    const names = loadRows(env).rows.map((r) => `${r.group}|${r.name}`);
    expect(names).toEqual([
      "Built-in|codemode",
      "Built-in|llama.cpp",
      "Built-in|mcp",
      "Built-in|tool-search",
      "Extensions|dirext/index.ts",
      "Extensions|loose.ts",
      "Extensions|plocal.ts",
      "Package: zpkg|a/index.ts",
      "Package: zpkg|b/index.ts",
      "Package: zpkg|ext-switch/index.ts",
      "Package: zpkg|prompt:p1.md",
      "Package: zpkg|prompt:p2.md",
      "Package: zpkg|skill:s1",
      "Package: zpkg|top.ts",
      "Skills|dummy",
      "Prompts|pr.md",
      "Themes|x.json",
    ]);
  });

  test("reports a non-local package as skipped", () => {
    setSettings("user", { packages: ["npm:foo"] });
    expect(loadRows(env).skipped[0]).toContain("npm:foo");
  });

  test("reports a missing local package", () => {
    setSettings("user", { packages: [join(root, "gone")] });
    expect(loadRows(env).skipped[0]).toContain("does not exist");
  });

  test("lists a package once when user and project name it", () => {
    setSettings("user", { packages: [join(root, "pkg")] });
    setSettings("project", { packages: [{ source: "../../pkg", autoload: false }] });
    expect(loadRows(env).rows.filter((r) => r.name === "a/index.ts").length).toBe(1);
  });
});

describe("state", () => {
  test("default is on", () => {
    expect(row("loose.ts")).toMatchObject({ enabled: true, scope: "default" });
  });

  test("reads the entries that pi config wrote", () => {
    setSettings("user", {
      extensions: ["-extensions/loose.ts", "-builtin:mcp", "+builtin:tool-search"],
      skills: ["-skills/dummy/SKILL.md"],
      themes: ["!themes/*.json"],
    });
    expect(row("loose.ts")).toMatchObject({ enabled: false, scope: "user" });
    expect(row("mcp")).toMatchObject({ enabled: false, scope: "user" });
    expect(row("tool-search")).toMatchObject({ enabled: true, scope: "user" });
    expect(row("dummy")).toMatchObject({ enabled: false, scope: "user" });
    expect(row("x.json")).toMatchObject({ enabled: false, scope: "user" });
    expect(row("codemode")).toMatchObject({ enabled: true, scope: "default" });
  });

  test("project overrides user, with an absolute path for a user resource", () => {
    const loose = join(env.agentDir, "extensions", "loose.ts");
    setSettings("user", { extensions: ["-extensions/loose.ts"] });
    setSettings("project", { extensions: [loose, `+${loose}`] });
    expect(row("loose.ts")).toMatchObject({ enabled: true, scope: "project" });
  });

  test("project-local resource uses a path relative to .pi", () => {
    setSettings("project", { extensions: ["-extensions/plocal.ts"] });
    expect(row("plocal.ts")).toMatchObject({ enabled: false, scope: "project" });
  });

  test("package filter: missing key all, empty none, plain entries narrow, signed entries subtract", () => {
    setSettings("user", {
      packages: [{ source: join(root, "pkg"), extensions: ["-a/index.ts", "+b/index.ts"], prompts: ["prompts/*.md", "!prompts/p1.md"] }],
    });
    expect(row("a/index.ts")).toMatchObject({ enabled: false, scope: "user" });
    expect(row("b/index.ts")).toMatchObject({ enabled: true, scope: "user" });
    expect(row("top.ts")).toMatchObject({ enabled: true, scope: "user" });
    expect(row("prompt:p1.md").enabled).toBe(false);
    expect(row("prompt:p2.md").enabled).toBe(true);
    setSettings("user", { packages: [{ source: join(root, "pkg"), extensions: [] }] });
    expect(row("a/index.ts")).toMatchObject({ enabled: false, scope: "user" });
    setSettings("user", { packages: [join(root, "pkg")] });
    expect(row("a/index.ts")).toMatchObject({ enabled: true, scope: "default" });
  });

  test("project delta over a user package", () => {
    setSettings("user", { packages: [{ source: join(root, "pkg"), extensions: ["-a/index.ts"] }] });
    setSettings("project", { packages: [{ source: "../../pkg", autoload: false, extensions: ["-b/index.ts", "+a/index.ts"] }] });
    expect(row("a/index.ts")).toMatchObject({ enabled: true, scope: "project" });
    expect(row("b/index.ts")).toMatchObject({ enabled: false, scope: "project" });
    expect(row("top.ts")).toMatchObject({ enabled: true, scope: "user" });
  });

  test("project entry without autoload false replaces the user entry", () => {
    setSettings("user", { packages: [{ source: join(root, "pkg"), extensions: ["-a/index.ts"] }] });
    setSettings("project", { packages: ["../../pkg"] });
    expect(row("a/index.ts")).toMatchObject({ enabled: true, scope: "project" });
  });
});

describe("applyToggle", () => {
  test("built-in off and on, as pi config writes it", () => {
    let s = applyToggle(env, row("mcp"), "user", false, {});
    expect(s).toEqual({ extensions: ["-builtin:mcp"] });
    s = applyToggle(env, row("tool-search"), "user", false, s);
    expect(s).toEqual({ extensions: ["-builtin:mcp", "-builtin:tool-search"] });
    setSettings("user", s);
    s = applyToggle(env, row("mcp"), "user", true, s);
    expect(s).toEqual({ extensions: ["-builtin:tool-search", "+builtin:mcp"] });
  });

  test("loose resources of every kind, user scope", () => {
    const cases: [string, string, string][] = [
      ["loose.ts", "extensions", "extensions/loose.ts"],
      ["dirext/index.ts", "extensions", "extensions/dirext/index.ts"],
      ["dummy", "skills", "skills/dummy/SKILL.md"],
      ["pr.md", "prompts", "prompts/pr.md"],
      ["x.json", "themes", "themes/x.json"],
    ];
    for (const [name, key, entry] of cases) {
      expect(applyToggle(env, row(name), "user", false, {})).toEqual({ [key]: [`-${entry}`] });
    }
  });

  test("keeps other keys and entries", () => {
    const before = { theme: "dark", extensions: ["keep.ts"] };
    const after = applyToggle(env, row("loose.ts"), "user", false, before);
    expect(after).toEqual({ theme: "dark", extensions: ["keep.ts", "-extensions/loose.ts"] });
    expect(before.extensions).toEqual(["keep.ts"]);
  });

  test("enable replaces the minus entry and an exact exclusion", () => {
    const s = { skills: ["-skills/dummy/SKILL.md", "!skills/dummy/SKILL.md"] };
    expect(applyToggle(env, row("dummy"), "user", true, s)).toEqual({ skills: ["+skills/dummy/SKILL.md"] });
  });

  test("user resource in project scope: plain absolute path, then the signed one", () => {
    const skill = join(env.agentDir, "skills", "dummy", "SKILL.md");
    const s = applyToggle(env, row("dummy"), "project", false, {});
    expect(s).toEqual({ skills: [skill, `-${skill}`] });
    expect(applyToggle(env, row("dummy"), "project", true, s)).toEqual({ skills: [skill, `+${skill}`] });
  });

  test("project resource uses a path relative to .pi and refuses user scope", () => {
    expect(applyToggle(env, row("plocal.ts"), "project", false, {})).toEqual({ extensions: ["-extensions/plocal.ts"] });
    expect(() => applyToggle(env, row("plocal.ts"), "user", false, {})).toThrow("lives in the project");
  });

  test("package resource: string entry becomes an object", () => {
    setSettings("user", { packages: [join(root, "pkg")] });
    const s = applyToggle(env, row("a/index.ts"), "user", false, settings("user"));
    expect(s).toEqual({ packages: [{ source: join(root, "pkg"), extensions: ["-a/index.ts"] }] });
  });

  test("package resource: enable moves the entry to the end and drops the exclusion glob", () => {
    setSettings("user", {
      packages: [{ source: join(root, "pkg"), extensions: ["-a/index.ts", "-b/index.ts"], prompts: ["prompts/*.md", "!prompts/p1.md"] }],
    });
    let s = applyToggle(env, row("a/index.ts"), "user", true, settings("user"));
    expect((s.packages as any)[0].extensions).toEqual(["-b/index.ts", "+a/index.ts"]);
    s = applyToggle(env, row("prompt:p1.md"), "user", true, settings("user"));
    expect((s.packages as any)[0].prompts).toEqual(["prompts/*.md", "+prompts/p1.md"]);
  });

  test("package resource in project scope adds an autoload false delta with a relative source", () => {
    setSettings("user", { packages: [join(root, "pkg")] });
    const s = applyToggle(env, row("a/index.ts"), "project", false, {});
    expect(s).toEqual({ packages: [{ source: "../../pkg", autoload: false, extensions: ["-a/index.ts"] }] });
  });

  test("package that is not in user settings cannot change in user scope", () => {
    setSettings("project", { packages: ["../../pkg"] });
    expect(() => applyToggle(env, row("a/index.ts"), "user", false, {})).toThrow("Switch to project scope");
  });

  test("refuses to disable ext-switch and says why", () => {
    setSettings("user", { packages: [join(root, "pkg")] });
    const self = row("ext-switch/index.ts");
    expect(self.protected).toBe(true);
    expect(() => applyToggle(env, self, "user", false, settings("user"))).toThrow("provides /ext");
    expect(() => applyToggle(env, self, "user", true, settings("user"))).not.toThrow();
  });
});

describe("files", () => {
  test("toggle writes 2-space JSON without a temp file and the state round-trips", () => {
    setSettings("user", { theme: "dark" });
    toggle(env, row("loose.ts"), "user", false);
    expect(readFileSync(settingsPath("user", env), "utf8")).toBe('{\n  "theme": "dark",\n  "extensions": [\n    "-extensions/loose.ts"\n  ]\n}');
    expect(readdirSync(env.agentDir).filter((n) => n.includes("tmp"))).toEqual([]);
    expect(row("loose.ts")).toMatchObject({ enabled: false, scope: "user" });
    toggle(env, row("loose.ts"), "user", true);
    expect(row("loose.ts")).toMatchObject({ enabled: true, scope: "user" });
  });

  test("project scope creates .pi/settings.json", () => {
    toggle(env, row("mcp"), "project", false);
    expect(settings("project")).toEqual({ extensions: ["-builtin:mcp"] });
    expect(row("mcp")).toMatchObject({ enabled: false, scope: "project" });
  });

  test("a symlinked settings.json stays a symlink", () => {
    const real = join(root, "real.json");
    put(real, "{}");
    symlinkSync(real, settingsPath("user", env));
    toggle(env, row("mcp"), "user", false);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ extensions: ["-builtin:mcp"] });
  });

  test("invalid JSON names the file", () => {
    put(settingsPath("user", env), "{ nope");
    expect(() => loadRows(env)).toThrow(settingsPath("user", env));
  });

  test("a settings file that is not an object fails", () => {
    put(settingsPath("project", env), "[]");
    expect(() => loadRows(env)).toThrow("not a JSON object");
  });

  test("a wrong list type names the key and file", () => {
    setSettings("user", { extensions: "x" });
    expect(() => loadRows(env)).toThrow(/"extensions" in .*settings\.json/);
  });

  test("a missing agent directory fails", () => {
    expect(() => loadRows({ ...env, agentDir: join(root, "none") })).toThrow("PI_CODING_AGENT_DIR");
  });

  test("a write error names the file", () => {
    const mcp = row("mcp");
    rmSync(join(env.cwd, ".pi"), { recursive: true });
    writeFileSync(join(env.cwd, ".pi"), "x");
    expect(() => toggle(env, mcp, "project", false)).toThrow(join(env.cwd, ".pi", "settings.json"));
  });
});

describe("findRow", () => {
  test("finds by name and by name@origin, errors list the names", () => {
    put(join(env.cwd, ".pi", "extensions", "loose.ts"));
    const rows = loadRows(env).rows;
    expect(findRow(rows, "mcp").name).toBe("mcp");
    expect(findRow(rows, "loose.ts@project").origin).toBe("project");
    expect(() => findRow(rows, "loose.ts")).toThrow("loose.ts@project, loose.ts@user");
    expect(() => findRow(rows, "nope")).toThrow(/Unknown resource "nope".*codemode/);
  });
});
