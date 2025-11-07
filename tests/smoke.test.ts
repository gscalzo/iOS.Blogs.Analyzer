import { describe, expect, it, vi } from "vitest";
import { main } from "../src/index.js";

describe("main", () => {
  it("prints placeholder message", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    main();

    expect(logSpy).toHaveBeenCalledWith("iOS Blogs Analyzer CLI coming soon.");
    logSpy.mockRestore();
  });
});