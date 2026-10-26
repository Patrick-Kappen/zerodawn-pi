export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LifecycleOptions {
  timers: Timers;
  graceMs: number;
  agentsRunning: () => boolean;
  shutdown: () => void;
}

export const GRACE_MS = 2 * 60 * 60 * 1000;

export function createLifecycle(options: LifecycleOptions) {
  let mains = 0;
  let timer: unknown;
  let armed = false;

  function disarm(): void {
    if (!armed) return;
    options.timers.clearTimeout(timer);
    armed = false;
  }

  function arm(): void {
    armed = true;
    timer = options.timers.setTimeout(() => {
      armed = false;
      options.shutdown();
    }, options.graceMs);
  }

  function mainOpened(): void {
    mains += 1;
    disarm();
  }

  function mainClosed(): void {
    if (mains === 0) throw new Error("lifecycle: a main connection closed that was never opened.");
    mains -= 1;
    if (mains > 0) return;
    if (!options.agentsRunning()) {
      options.shutdown();
      return;
    }
    arm();
  }

  // A main pi that crashes before its hello must not leave the supervisor running.
  arm();

  return { mainOpened, mainClosed, isMainConnected: () => mains > 0 };
}
