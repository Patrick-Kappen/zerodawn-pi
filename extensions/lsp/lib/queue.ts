/**
 * Runs one check after the other. A newer edit of the same file replaces a run that did not start yet:
 * its task sees isCurrent() false and returns without a call. reset() drops every pending run.
 */
export class EditQueue {
  private tail: Promise<void> = Promise.resolve();
  private versions = new Map<string, number>();
  private generation = 0;

  reset(): void {
    this.generation++;
    this.versions.clear();
    this.tail = Promise.resolve();
  }

  schedule(file: string, task: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    const generation = this.generation;
    const version = (this.versions.get(file) ?? 0) + 1;
    this.versions.set(file, version);
    const isCurrent = () => generation === this.generation && this.versions.get(file) === version;
    const run = this.tail.then(() => (isCurrent() ? task(isCurrent) : undefined));
    // A failed run must not stop the runs behind it; the caller gets the failure from the returned promise.
    this.tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** Ends when the runs scheduled so far end. */
  idle(): Promise<void> {
    return this.tail;
  }
}
