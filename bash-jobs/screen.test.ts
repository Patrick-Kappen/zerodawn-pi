import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Screen, stripScript } from "./screen.ts";

const E = "\x1b";

function plain(input: string): string[] {
  const s = new Screen();
  s.feed(input);
  return s.plain();
}

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
}

function render(name: string): Screen {
  const s = new Screen();
  s.feed(stripScript(fixture(name)).body);
  return s;
}

describe("control characters", () => {
  test("newline keeps the column, CR LF starts a new line", () => {
    expect(plain("ab\r\ncd")).toEqual(["ab", "cd"]);
    expect(plain("ab\ncd")).toEqual(["ab", "  cd"]);
  });
  test("CR overwrites from column 0", () => {
    expect(plain("hello\rab")).toEqual(["abllo"]);
  });
  test("backspace moves left and stops at column 0", () => {
    expect(plain("abc\bX")).toEqual(["abX"]);
    expect(plain("\b\bX")).toEqual(["X"]);
  });
  test("tab stops at every 8 columns", () => {
    expect(plain("a\tb")).toEqual(["a       b"]);
    expect(plain("12345678\tb")).toEqual(["12345678        b"]);
  });
  test("other control characters are dropped", () => {
    expect(plain("a\x07b\x00c")).toEqual(["abc"]);
  });
  test("writing past the line end pads with spaces", () => {
    expect(plain("a\x1b[4Gb")).toEqual(["a  b"]);
  });
  test("one column per code point", () => {
    expect(plain("😀b\rX")).toEqual(["Xb"]);
  });
});

describe("CSI", () => {
  test("K0 erases to the end of line", () => {
    expect(plain(`abcdef\x1b[3D${E}[K`)).toEqual(["abc"]);
  });
  test("K1 blanks up to and including the cursor", () => {
    expect(plain(`abcdef\x1b[3D${E}[1K`)).toEqual(["    ef"]);
  });
  test("K2 clears the line and keeps the cursor", () => {
    expect(plain(`abcdef${E}[2KX`)).toEqual(["      X"]);
  });
  test("A and B move inside the buffer and clamp", () => {
    expect(plain(`a\r\nb\r\nc${E}[1A${E}[2KX`)).toEqual(["a", " X", "c"]);
    expect(plain(`a\r\nb${E}[9A\rX`)).toEqual(["X", "b"]);
    expect(plain(`a\r\nb${E}[9A${E}[9B\rX`)).toEqual(["a", "X"]);
  });
  test("G sets the column (1-based)", () => {
    expect(plain(`abcdef${E}[2GX`)).toEqual(["aXcdef"]);
    expect(plain(`abcdef${E}[GX`)).toEqual(["Xbcdef"]);
  });
  test("C and D move right and left", () => {
    expect(plain(`ab${E}[2CX`)).toEqual(["ab  X"]);
    expect(plain(`abcd${E}[2DX`)).toEqual(["abXd"]);
    expect(plain(`ab${E}[9DX`)).toEqual(["Xb"]);
  });
  test("J2 and J3 clear the buffer", () => {
    expect(plain(`a\r\nb${E}[2JX`)).toEqual(["X"]);
    expect(plain(`a\r\nb${E}[3JX`)).toEqual(["X"]);
  });
  test("J0 and J1 clear the line in their direction", () => {
    expect(plain(`abcdef${E}[3D${E}[0J`)).toEqual(["abc"]);
    expect(plain(`abcdef${E}[3D${E}[1J`)).toEqual(["    ef"]);
  });
  test("H moves to row and column, clamped to the buffer", () => {
    expect(plain(`a\r\nb\r\nc${E}[2;3HX`)).toEqual(["a", "b X", "c"]);
    expect(plain(`a\r\nb${E}[9;1HX`)).toEqual(["a", "X"]);
    expect(plain(`a\r\nb${E}[HX`)).toEqual(["X", "b"]);
  });
  test("private modes are ignored", () => {
    expect(plain(`${E}[?25lab${E}[?25h${E}[?2004h`)).toEqual(["ab"]);
  });
  test("unknown CSI is dropped", () => {
    expect(plain(`a${E}[5~b${E}[3;4zc${E}[ qd`)).toEqual(["abcd"]);
  });
});

describe("other escapes", () => {
  test("OSC ended by BEL or ST is dropped", () => {
    expect(plain(`${E}]0;title\x07ab${E}]8;;http://x${E}\\cd`)).toEqual(["abcd"]);
  });
  test("charset and keypad escapes are dropped", () => {
    expect(plain(`${E}(Ba${E}=b${E}>c${E}M`)).toEqual(["abc"]);
  });
});

describe("chunking", () => {
  test("a split escape sequence is kept for the next chunk", () => {
    const whole = `ab${E}[31mred${E}[0m\r${E}[2Kx${E}]0;t\x07y`;
    const expected = new Screen();
    expected.feed(whole);
    for (let cut = 1; cut < whole.length; cut++) {
      const s = new Screen();
      s.feed(whole.slice(0, cut));
      s.feed(whole.slice(cut));
      expect(s.lines()).toEqual(expected.lines());
    }
  });
  test("a split OSC terminator ESC \\ is kept", () => {
    const s = new Screen();
    s.feed(`${E}]0;t${E}`);
    s.feed("\\ok");
    expect(s.plain()).toEqual(["ok"]);
  });
});

describe("SGR", () => {
  test("lines() carries styles and ends styled lines with a reset", () => {
    const s = new Screen();
    s.feed(`${E}[32mgreen${E}[0m plain`);
    expect(s.lines()).toEqual([`${E}[32mgreen${E}[0m plain`]);
    expect(s.plain()).toEqual(["green plain"]);
  });
  test("a style active at a line start is re-emitted on the next line", () => {
    const s = new Screen();
    s.feed(`${E}[1;31mab\r\ncd`);
    expect(s.lines()).toEqual([`${E}[1;31mab${E}[0m`, `${E}[1;31mcd${E}[0m`]);
  });
  test("reset inside a sequence, empty m, and extended colors", () => {
    const s = new Screen();
    s.feed(`${E}[1ma${E}[0;4mb${E}[mc${E}[38;5;200md${E}[38;2;1;2;3me`);
    expect(s.lines()).toEqual([`${E}[1ma${E}[0m${E}[4mb${E}[0mc${E}[38;5;200md${E}[0m${E}[38;5;200;38;2;1;2;3me${E}[0m`]);
  });
  test("overwriting keeps the new style", () => {
    const s = new Screen();
    s.feed(`ab\r${E}[31mX`);
    expect(s.lines()).toEqual([`${E}[31mX${E}[0mb`]);
  });
});

describe("stripScript", () => {
  test("removes header and footer and reads the exit code", () => {
    const text = 'Script started on 2026-01-01 [COMMAND="x"]\nout\r\n\nScript done on 2026-01-01 [COMMAND_EXIT_CODE="3"]\n';
    expect(stripScript(text)).toEqual({ body: "out\r\n", exitCode: 3 });
  });
  test("text without header or footer is unchanged", () => {
    expect(stripScript("plain\n")).toEqual({ body: "plain\n" });
  });
  test("footer without exit code gives no exit code", () => {
    expect(stripScript("a\nScript done on now\n")).toEqual({ body: "a" });
  });
});

describe("fixtures", () => {
  test("progress.txt: bar overwritten, then line fixed with 1A 2K", () => {
    const s = render("progress.txt");
    expect(s.plain()).toEqual(["[####################] 100%", "done", "step 1", "step 2 (fixed)", ""]);
    const lines = s.lines();
    expect(lines[0]).toBe(`${E}[32m[####################]${E}[0m 100%`);
    expect(lines[1]).toBe(`${E}[1mdone${E}[0m`);
  });
  test("just-test.txt: bold command echo and output", () => {
    const s = render("just-test.txt");
    expect(s.plain()).toEqual(["sleep 3", 'echo "41 passed"', "41 passed", ""]);
    expect(s.lines()[0]).toBe(`${E}[1msleep 3${E}[0m`);
  });
  test("erase-line.txt: ESC[K progress lines", () => {
    const s = render("erase-line.txt");
    expect(s.plain()).toEqual(["Building", "step 3/3 ok", "end", ""]);
    expect(s.lines()[1]).toBe(`${E}[32mstep 3/3 ok${E}[0m`);
  });
  test("exit codes are read from the fixtures", () => {
    expect(stripScript(fixture("progress.txt")).exitCode).toBe(0);
    expect(stripScript(fixture("just-test.txt")).exitCode).toBe(0);
  });
});
