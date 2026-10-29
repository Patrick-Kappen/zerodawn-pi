import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { splitChain } from "../../../shared/chain.ts";
import { ROUTES_CHAINS, routePart } from "../../../shared/route.ts";

type Format = (output: string, exit: number) => string;

/** A command with its routed parts: the script for the shell, and the format of each marked part. */
export type Routed = { script: string; nonce: string; formats: Map<number, Format> };

/** Tells the guards of the other extensions that bash runs a chain part by part. */
export function registerChainRouting(pi: Pick<ExtensionAPI, "events">): void {
  pi.events.on(ROUTES_CHAINS, (data) => {
    (data as { on: boolean }).on = true;
  });
}

/**
 * Asks the other extensions how to run each part of a command. A routed part runs between two markers, so its
 * output can change after the job; the other parts stay as they are. Undefined when no part has a route.
 */
export function routeChain(pi: Pick<ExtensionAPI, "events">, command: string): Routed | undefined {
  const parts = splitChain(command);
  if (!parts) return undefined;
  const nonce = randomBytes(4).toString("hex");
  const formats = new Map<number, Format>();
  let routed = false;
  const script = parts
    .map((part, i) => {
      const text = part.text.trim();
      // A background part writes into the output of the next parts, so its markers would not enclose it.
      const route = text && part.sep !== "&" ? routePart(pi, text) : undefined;
      if (!route) return part.text + part.sep;
      routed = true;
      const [before, after] = [part.text.match(/^\s*/)![0], part.text.match(/\s*$/)![0]];
      if (!route.format) return `${before}${route.command}${after}${part.sep}`;
      formats.set(i, route.format);
      return `${before}${wrap(route.command, nonce, i)}${after}${part.sep}`;
    })
    .join("");
  return routed ? { script, nonce, formats } : undefined;
}

// A new line ends the part, so a heredoc or a comment at its end stays closed. The group keeps cd and variables, and returns the exit of the part.
function wrap(command: string, nonce: string, i: number): string {
  return `{ printf '\\036${nonce}:${i}\\n'; ${command}\n__pi_exit=$?; printf '\\n\\036${nonce}:${i}:%d\\n' "$__pi_exit"; (exit "$__pi_exit"); }`;
}

/** The output of the job with the output of each routed part in its format, and without markers. */
export function formatOutput(output: string, routed: Routed): string {
  const { nonce, formats } = routed;
  const part = new RegExp(`\\x1e${nonce}:(\\d+)\\n([\\s\\S]*?)\\n\\x1e${nonce}:\\1:(\\d+)\\n`, "g");
  return output
    .replace(part, (_m, i: string, text: string, exit: string) => {
      const format = formats.get(Number(i));
      if (!format) throw new Error(`bash: no format for the routed part ${i} of the chain`);
      const out = format(text.replace(/\n+$/, ""), Number(exit));
      return out ? `${out}\n` : "";
    })
    .replace(new RegExp(`\\x1e${nonce}:\\d+(:\\d+)?\\n`, "g"), "");
}
