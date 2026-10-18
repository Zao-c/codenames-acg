/** One identity at a time, shared across mounted routes; rejected requests never stick. */
export class ScopedResource<T> {
  private entry?: { key: string; until: number; promise: Promise<T> };
  constructor(private ttl = 300_000) {}
  clear() { this.entry = undefined; }
  get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.entry?.key === key && this.entry.until > Date.now()) return this.entry.promise;
    const promise = load();
    const entry = { key, until: Infinity, promise };
    this.entry = entry;
    promise.then(() => { if (this.entry === entry) entry.until = Date.now() + this.ttl; }, () => { if (this.entry === entry) this.entry = undefined; });
    return promise;
  }
}
