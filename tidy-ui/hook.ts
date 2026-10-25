type Fn = (...args: any[]) => any;
export type Layer = (self: any, next: (...args: any[]) => any, args: any) => any;
type Slot = { original: Fn; layers: Map<string, Layer> };

const SLOTS = Symbol.for("tidy-ui.hook.slots");

function slots(target: Record<string | symbol, unknown>): Map<string, Slot> {
  if (!Object.hasOwn(target, SLOTS)) {
    Object.defineProperty(target, SLOTS, { value: new Map<string, Slot>() });
  }
  return target[SLOTS] as Map<string, Slot>;
}

export function hook(proto: object, method: string, key: string, layer: Layer): void {
  const target = proto as Record<string | symbol, unknown>;
  const all = slots(target);
  let slot = all.get(method);
  if (!slot) {
    const original = target[method];
    if (typeof original !== "function") {
      throw new Error(`tidy-ui: ${proto.constructor.name}.${method} is missing. Pi changed its TUI; update the "${key}" hook.`);
    }
    const created: Slot = { original: original as Fn, layers: new Map() };
    slot = created;
    all.set(method, created);
    target[method] = function (this: unknown, ...args: unknown[]): unknown {
      const layers = [...created.layers.values()];
      const call = (index: number, callArgs: unknown[]): unknown =>
        index < 0 ? created.original.apply(this, callArgs) : layers[index](this, (...nextArgs: unknown[]) => call(index - 1, nextArgs), callArgs);
      return call(layers.length - 1, args);
    };
  }
  slot.layers.delete(key);
  slot.layers.set(key, layer);
}

export function unhook(proto: object, method: string, key: string): void {
  slots(proto as Record<string | symbol, unknown>)
    .get(method)
    ?.layers.delete(key);
}
