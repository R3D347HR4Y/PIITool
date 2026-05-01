import type { ScopeRequest } from "./types.ts";

export interface ScopeRunner {
  run<T>(scope: ScopeRequest, fn: () => Promise<T>): Promise<T>;
}

export class DirectScopeRunner implements ScopeRunner {
  async run<T>(_scope: ScopeRequest, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
