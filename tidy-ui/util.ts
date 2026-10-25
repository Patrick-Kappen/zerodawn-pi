export function globalState<T>(key: string, init: () => T): () => T {
  const symbol = Symbol.for(key);
  const globals = globalThis as unknown as Record<symbol, T | undefined>;
  return () => (globals[symbol] ??= init());
}

export function oneLine(text: string, { ansi = false } = {}): string {
  return text
    .replace(ansi ? /[\r\n\t]+/g : /[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
}
