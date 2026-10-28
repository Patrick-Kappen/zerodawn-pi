import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { splitChain } from "./chain.ts";

/** The channel where the bash tool asks the other extensions how to run one part of a command. */
export const ROUTE_PART = "bash:route-part";
/** The channel where a guard asks whether the bash tool runs a chain part by part. */
export const ROUTES_CHAINS = "bash:routes-chains";

/**
 * How the bash tool runs one part of a command. `command` runs in the shell in place of the part, and `format`
 * changes the output of that part after the job.
 */
export type Route = { command: string; format?: (output: string, exit: number) => string };

/** bash emits one query per part. The first extension that knows the part sets route. */
export type RouteQuery = { part: string; route?: Route };

type Events = Pick<ExtensionAPI, "events">;

/** Asks the extensions how to run one part; undefined when no extension knows it. */
export function routePart(pi: Events, part: string): Route | undefined {
  const query: RouteQuery = { part };
  pi.events.emit(ROUTE_PART, query);
  return query.route;
}

/** Answers ROUTE_PART for the parts that `route` knows. */
export function onRoutePart(pi: Events, route: (part: string) => Route | undefined): void {
  pi.events.on(ROUTE_PART, (data) => {
    const query = data as RouteQuery;
    query.route ??= route(query.part);
  });
}

/** True when the command has more than one part and the bash tool runs it part by part. A guard then checks each part through ROUTE_PART. */
export function routedChain(pi: Events, command: string): boolean {
  const parts = splitChain(command);
  if (!parts || parts.length < 2) return false;
  const query = { on: false };
  pi.events.emit(ROUTES_CHAINS, query);
  return query.on;
}
