export interface AsyncPoolOptions {
  concurrency: number;
  signal?: AbortSignal;
}

export async function asyncPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number, signal?: AbortSignal) => Promise<R>,
  options: AsyncPoolOptions,
): Promise<R[]> {
  const { concurrency, signal } = options;

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("concurrency must be a positive integer");
  }

  const total = items.length;
  if (total === 0) {
    return [];
  }

  throwIfAborted(signal);

  const results = new Array<R>(total);
  let nextIndex = 0;

  const runner = async (): Promise<void> => {
    while (true) {
      throwIfAborted(signal);

      const currentIndex = nextIndex;
      if (currentIndex >= total) {
        return;
      }
      nextIndex = currentIndex + 1;

      results[currentIndex] = await worker(items[currentIndex], currentIndex, signal);
    }
  };

  const poolSize = Math.min(concurrency, total);
  const runners = Array.from({ length: poolSize }, () => runner());
  await Promise.all(runners);
  return results;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) {
    return;
  }

  if (!signal.aborted) {
    return;
  }

  const reason = signal.reason;

  if (reason instanceof Error) {
    throw reason;
  }

  if (typeof reason === "string") {
    const error = new Error(reason);
    error.name = "AbortError";
    throw error;
  }

  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  throw error;
}