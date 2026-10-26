import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Screen, stripScript } from "./screen.ts";

const E = "\x1b";

function plain(input: string): string[] {
  const s = new Screen();
  s.feed(input);
  return s.plain();
}

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
}

function render(name: string): Screen {
  const s = new Screen();
  s.feed(stripScript(fixture(name)).body);
  return s;
}

describe("control characters", () => {
  test("LF and CR LF both start a new line, because pipe output has no CR", () => {
    assert.deepEqual(plain("ab\r\ncd"), ["ab", "cd"]);
    assert.deepEqual(plain("ab\ncd"), ["ab", "cd"]);
  });
  test("CR overwrites from column 0", () => {
    assert.deepEqual(plain("hello\rab"), ["abllo"]);
  });
  test("backspace moves left and stops at column 0", () => {
    assert.deepEqual(plain("abc\bX"), ["abX"]);
    assert.deepEqual(plain("\b\bX"), ["X"]);
  });
  test("tab stops at every 8 columns", () => {
    assert.deepEqual(plain("a\tb"), ["a       b"]);
    assert.deepEqual(plain("12345678\tb"), ["12345678        b"]);
  });
  test("other control characters are dropped", () => {
    assert.deepEqual(plain("a\x07b\x00c"), ["abc"]);
  });
  test("writing past the line end pads with spaces", () => {
    assert.deepEqual(plain("a\x1b[4Gb"), ["a  b"]);
  });
  test("one column per code point", () => {
    assert.deepEqual(plain("😀b\rX"), ["Xb"]);
  });
});

describe("CSI", () => {
  test("K0 erases to the end of line", () => {
    assert.deepEqual(plain(`abcdef\x1b[3D${E}[K`), ["abc"]);
  });
  test("K1 blanks up to and including the cursor", () => {
    assert.deepEqual(plain(`abcdef\x1b[3D${E}[1K`), ["    ef"]);
  });
  test("K2 clears the line and keeps the cursor", () => {
    assert.deepEqual(plain(`abcdef${E}[2KX`), ["      X"]);
  });
  test("A and B move inside the buffer and clamp", () => {
    assert.deepEqual(plain(`a\r\nb\r\nc${E}[1A${E}[2KX`), ["a", " X", "c"]);
    assert.deepEqual(plain(`a\r\nb${E}[9A\rX`), ["X", "b"]);
    assert.deepEqual(plain(`a\r\nb${E}[9A${E}[9B\rX`), ["a", "X"]);
  });
  test("G sets the column (1-based)", () => {
    assert.deepEqual(plain(`abcdef${E}[2GX`), ["aXcdef"]);
    assert.deepEqual(plain(`abcdef${E}[GX`), ["Xbcdef"]);
  });
  test("C and D move right and left", () => {
    assert.deepEqual(plain(`ab${E}[2CX`), ["ab  X"]);
    assert.deepEqual(plain(`abcd${E}[2DX`), ["abXd"]);
    assert.deepEqual(plain(`ab${E}[9DX`), ["Xb"]);
  });
  test("J2 and J3 clear the buffer", () => {
    assert.deepEqual(plain(`a\r\nb${E}[2JX`), ["X"]);
    assert.deepEqual(plain(`a\r\nb${E}[3JX`), ["X"]);
  });
  test("J0 and J1 clear the line in their direction", () => {
    assert.deepEqual(plain(`abcdef${E}[3D${E}[0J`), ["abc"]);
    assert.deepEqual(plain(`abcdef${E}[3D${E}[1J`), ["    ef"]);
  });
  test("H moves to row and column, clamped to the buffer", () => {
    assert.deepEqual(plain(`a\r\nb\r\nc${E}[2;3HX`), ["a", "b X", "c"]);
    assert.deepEqual(plain(`a\r\nb${E}[9;1HX`), ["a", "X"]);
    assert.deepEqual(plain(`a\r\nb${E}[HX`), ["X", "b"]);
  });
  test("private modes are ignored", () => {
    assert.deepEqual(plain(`${E}[?25lab${E}[?25h${E}[?2004h`), ["ab"]);
  });
  test("unknown CSI is dropped", () => {
    assert.deepEqual(plain(`a${E}[5~b${E}[3;4zc${E}[ qd`), ["abcd"]);
  });
});

describe("other escapes", () => {
  test("OSC ended by BEL or ST is dropped", () => {
    assert.deepEqual(plain(`${E}]0;title\x07ab${E}]8;;http://x${E}\\cd`), ["abcd"]);
  });
  test("charset and keypad escapes are dropped", () => {
    assert.deepEqual(plain(`${E}(Ba${E}=b${E}>c${E}M`), ["abc"]);
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
      assert.deepEqual(s.lines(), expected.lines());
    }
  });
  test("a split OSC terminator ESC \\ is kept", () => {
    const s = new Screen();
    s.feed(`${E}]0;t${E}`);
    s.feed("\\ok");
    assert.deepEqual(s.plain(), ["ok"]);
  });
});

describe("SGR", () => {
  test("lines() carries styles and ends styled lines with a reset", () => {
    const s = new Screen();
    s.feed(`${E}[32mgreen${E}[0m plain`);
    assert.deepEqual(s.lines(), [`${E}[32mgreen${E}[0m plain`]);
    assert.deepEqual(s.plain(), ["green plain"]);
  });
  test("a style active at a line start is re-emitted on the next line", () => {
    const s = new Screen();
    s.feed(`${E}[1;31mab\r\ncd`);
    assert.deepEqual(s.lines(), [`${E}[1;31mab${E}[0m`, `${E}[1;31mcd${E}[0m`]);
  });
  test("reset inside a sequence, empty m, and extended colors", () => {
    const s = new Screen();
    s.feed(`${E}[1ma${E}[0;4mb${E}[mc${E}[38;5;200md${E}[38;2;1;2;3me`);
    assert.deepEqual(s.lines(), [`${E}[1ma${E}[0m${E}[4mb${E}[0mc${E}[38;5;200md${E}[0m${E}[38;5;200;38;2;1;2;3me${E}[0m`]);
  });
  test("overwriting keeps the new style", () => {
    const s = new Screen();
    s.feed(`ab\r${E}[31mX`);
    assert.deepEqual(s.lines(), [`${E}[31mX${E}[0mb`]);
  });
});

describe("stripScript", () => {
  test("removes header and footer and reads the exit code", () => {
    const text = 'Script started on 2026-01-01 [COMMAND="x"]\nout\r\n\nScript done on 2026-01-01 [COMMAND_EXIT_CODE="3"]\n';
    assert.deepEqual(stripScript(text), { body: "out\r\n", exitCode: 3 });
  });
  test("text without header or footer is unchanged", () => {
    assert.deepEqual(stripScript("plain\n"), { body: "plain\n" });
  });
  test("footer without exit code gives no exit code", () => {
    assert.deepEqual(stripScript("a\nScript done on now\n"), { body: "a" });
  });
});

describe("fixtures", () => {
  test("progress.txt: bar overwritten, then line fixed with 1A 2K", () => {
    const s = render("progress.txt");
    assert.deepEqual(s.plain(), ["[####################] 100%", "done", "step 1", "step 2 (fixed)", ""]);
    const lines = s.lines();
    assert.equal(lines[0], `${E}[32m[####################]${E}[0m 100%`);
    assert.equal(lines[1], `${E}[1mdone${E}[0m`);
  });
  test("just-test.txt: bold command echo and output", () => {
    const s = render("just-test.txt");
    assert.deepEqual(s.plain(), ["sleep 3", 'echo "41 passed"', "41 passed", ""]);
    assert.equal(s.lines()[0], `${E}[1msleep 3${E}[0m`);
  });
  test("erase-line.txt: ESC[K progress lines", () => {
    const s = render("erase-line.txt");
    assert.deepEqual(s.plain(), ["Building", "step 3/3 ok", "end", ""]);
    assert.equal(s.lines()[1], `${E}[32mstep 3/3 ok${E}[0m`);
  });
  test("exit codes are read from the fixtures", () => {
    assert.equal(stripScript(fixture("progress.txt")).exitCode, 0);
    assert.equal(stripScript(fixture("just-test.txt")).exitCode, 0);
  });
});
