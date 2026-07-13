export interface HistorySnapshot<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

export class BoundedHistory<T> {
  private past: T[] = [];
  private current: T;
  private future: T[] = [];

  constructor(initial: T, private readonly limit = 200) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("History limit must be a positive integer");
    }
    this.current = initial;
  }

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  get snapshot(): HistorySnapshot<T> {
    return {
      past: [...this.past],
      present: this.current,
      future: [...this.future],
    };
  }

  push(next: T): T {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
    return this.current;
  }

  undo(): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.unshift(this.current);
    this.current = previous;
    return this.current;
  }

  redo(): T | undefined {
    const next = this.future.shift();
    if (next === undefined) return undefined;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    return this.current;
  }

  reset(initial: T): void {
    this.past = [];
    this.current = initial;
    this.future = [];
  }
}

export function createHistory<T>(initial: T, limit = 200): BoundedHistory<T> {
  return new BoundedHistory(initial, limit);
}
