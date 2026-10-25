// Terminal screen model: turns a raw PTY stream into lines as a terminal shows them.

const ESC = "\x1b";
const BEL = "\x07";
const TAB_WIDTH = 8;

interface Cell {
  ch: string;
  style: string; // full SGR escape active when the cell was written, "" for default
}

const BLANK: Cell = { ch: " ", style: "" };

function param(params: number[], index: number, fallback: number): number {
  const value = params[index];
  return value === undefined || Number.isNaN(value) || value === 0 ? fallback : value;
}

export class Screen {
  private buffer: Cell[][] = [[]];
  private row = 0;
  private col = 0;
  private sgr: string[] = [];
  private pending = "";

  feed(chunk: string): void {
    const text = this.pending + chunk;
    this.pending = "";
    const chars = Array.from(text);
    let i = 0;
    while (i < chars.length) {
      const c = chars[i];
      if (c === ESC) {
        const used = this.escape(chars, i);
        if (used === 0) {
          this.pending = chars.slice(i).join("");
          return;
        }
        i += used;
        continue;
      }
      i++;
      this.control(c);
    }
  }

  lines(): string[] {
    return this.buffer.map((line) => {
      let out = "";
      let active = "";
      for (const cell of line) {
        if (cell.style !== active) {
          if (active !== "") out += `${ESC}[0m`;
          out += cell.style;
          active = cell.style;
        }
        out += cell.ch;
      }
      if (active !== "") out += `${ESC}[0m`;
      return out;
    });
  }

  plain(): string[] {
    return this.buffer.map((line) => line.map((cell) => cell.ch).join(""));
  }

  private control(c: string): void {
    switch (c) {
      case "\r":
        this.col = 0;
        return;
      case "\n":
        this.row++;
        while (this.buffer.length <= this.row) this.buffer.push([]);
        return;
      case "\b":
        this.col = Math.max(0, this.col - 1);
        return;
      case "\t":
        this.col = (Math.floor(this.col / TAB_WIDTH) + 1) * TAB_WIDTH;
        return;
    }
    if (c < " " || c === "\x7f") return;
    this.put(c);
  }

  private put(ch: string): void {
    const line = this.buffer[this.row];
    while (line.length < this.col) line.push(BLANK);
    line[this.col] = { ch, style: this.sgr.length ? `${ESC}[${this.sgr.join(";")}m` : "" };
    this.col++;
  }

  // Returns the number of code points used, or 0 when the sequence is incomplete.
  private escape(chars: string[], start: number): number {
    const next = chars[start + 1];
    if (next === undefined) return 0;
    if (next === "[") return this.csi(chars, start);
    if (next === "]") {
      for (let j = start + 2; j < chars.length; j++) {
        if (chars[j] === BEL) return j - start + 1;
        if (chars[j] === ESC) {
          if (chars[j + 1] === undefined) return 0;
          if (chars[j + 1] === "\\") return j - start + 2;
        }
      }
      return 0;
    }
    // Intermediate bytes (0x20-0x2F) such as `ESC ( B` take one final byte.
    let j = start + 1;
    while (chars[j] !== undefined && chars[j] >= " " && chars[j] <= "/") j++;
    if (chars[j] === undefined) return 0;
    return j - start + 1;
  }

  private csi(chars: string[], start: number): number {
    let j = start + 2;
    while (chars[j] !== undefined && chars[j] >= "0" && chars[j] <= "?") j++;
    while (chars[j] !== undefined && chars[j] >= " " && chars[j] <= "/") j++;
    const final = chars[j];
    if (final === undefined) return 0;
    const raw = chars.slice(start + 2, j).join("");
    if (final >= "@" && final <= "~") this.runCsi(raw, final);
    // A byte outside the CSI grammar ends the broken sequence; it is dropped with it.
    return j - start + 1;
  }

  private runCsi(raw: string, final: string): void {
    if (/[?<=>]/.test(raw[0] ?? "")) return; // private modes: ignore
    if (/[ -/]/.test(raw)) return; // intermediates: unknown, drop
    const params = raw === "" ? [] : raw.split(";").map((p) => (p === "" ? 0 : Number(p)));
    const n = param(params, 0, 1);
    const last = this.buffer.length - 1;
    switch (final) {
      case "m":
        this.setSgr(raw);
        return;
      case "K":
        this.eraseLine(params[0] ?? 0);
        return;
      case "A":
        this.row = Math.max(0, this.row - n);
        return;
      case "B":
        this.row = Math.min(last, this.row + n);
        return;
      case "C":
        this.col += n;
        return;
      case "D":
        this.col = Math.max(0, this.col - n);
        return;
      case "G":
        this.col = n - 1;
        return;
      case "H":
        this.row = Math.min(last, param(params, 0, 1) - 1);
        this.col = param(params, 1, 1) - 1;
        return;
      case "J": {
        const mode = params[0] ?? 0;
        if (mode === 2 || mode === 3) {
          this.buffer = [[]];
          this.row = 0;
          this.col = 0;
        } else if (mode === 0 || mode === 1) {
          this.eraseLine(mode);
        }
        return;
      }
    }
  }

  private eraseLine(mode: number): void {
    const line = this.buffer[this.row];
    if (mode === 0) {
      line.length = Math.min(line.length, this.col);
    } else if (mode === 1) {
      for (let c = 0; c <= this.col && c < line.length; c++) line[c] = BLANK;
    } else if (mode === 2) {
      line.length = 0;
    }
  }

  private setSgr(raw: string): void {
    const tokens = raw === "" ? ["0"] : raw.split(";").map((t) => (t === "" ? "0" : t));
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (Number(t) === 0) {
        this.sgr = [];
      } else if (t === "38" || t === "48" || t === "58") {
        const length = tokens[k + 1] === "2" ? 5 : 3; // 38;2;r;g;b or 38;5;n
        this.sgr.push(tokens.slice(k, k + length).join(";"));
        k += length - 1;
      } else {
        this.sgr.push(t);
      }
    }
  }
}

export function stripScript(text: string): { body: string; exitCode?: number } {
  let body = text;
  if (body.startsWith("Script started on")) {
    const eol = body.indexOf("\n");
    body = eol === -1 ? "" : body.slice(eol + 1);
  }
  const footer = body.lastIndexOf("\nScript done on");
  if (footer === -1) return { body };
  const block = body.slice(footer);
  body = body.slice(0, footer);
  const match = /COMMAND_EXIT_CODE="(\d+)"/.exec(block);
  return match ? { body, exitCode: Number(match[1]) } : { body };
}
