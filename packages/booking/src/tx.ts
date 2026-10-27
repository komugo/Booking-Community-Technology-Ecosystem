export type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

// NotPromise is the real guard. The runtime check only rolls back writes made before the first await.
export function tx<T>(storage: DurableObjectStorage, fn: () => NotPromise<T>): T {
  return storage.transactionSync(() => {
    const r = fn();
    if (typeof (r as { then?: unknown } | null | undefined)?.then === "function") throw new Error("async_in_transaction");
    return r;
  });
}
