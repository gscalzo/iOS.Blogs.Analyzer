import { describe, expect, it, vi } from "vitest";
import { asyncPool } from "../src/utils.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("asyncPool", () => {
  it("limits concurrent executions", async () => {
    const inputs = [0, 1, 2, 3, 4];
    let active = 0;
    let maxActive = 0;

    const results = await asyncPool(
      inputs,
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active -= 1;
        return value * 2;
      },
      { concurrency: 2 },
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([0, 2, 4, 6, 8]);
  });

  it("rejects invalid concurrency", async () => {
    await expect(asyncPool([1], async () => 1, { concurrency: 0 })).rejects.toThrow(RangeError);
  });

  it("respects abort signals", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);

    const worker = vi.fn(async (value: number) => value);

    await expect(asyncPool([1, 2], worker, { concurrency: 1, signal: controller.signal }))
      .rejects.toBe(reason);
    expect(worker).not.toHaveBeenCalled();
  });
});
