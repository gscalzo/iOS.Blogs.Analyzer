import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFilterConfig } from "../src/config.js";

const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

describe("loadFilterConfig", () => {
  it("normalizes languages and categories", async () => {
    const configPath = path.join(fixturesDir, "filter-config-sample.json");
    const config = await loadFilterConfig(configPath);

    expect(config.allowedLanguages).toEqual(["en", "es"]);
    expect(config.allowedCategories).toEqual(["platform", "noticias"]);
  });

  it("falls back to defaults when file is missing", async () => {
    const config = await loadFilterConfig(path.join(fixturesDir, "missing.json"));
    expect(config.allowedLanguages).toEqual(["en"]);
    expect(config.allowedCategories).toBeUndefined();
  });
});
