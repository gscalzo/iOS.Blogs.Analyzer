import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultConfigPath = path.resolve(__dirname, "../config/filter-config.json");

export interface FilterConfig {
  allowedLanguages?: string[];
  allowedCategories?: string[];
}

export interface NormalizedFilterConfig {
  allowedLanguages: string[];
  allowedCategories?: string[];
}

const FALLBACK_CONFIG: NormalizedFilterConfig = {
  allowedLanguages: ["en"],
};

export async function loadFilterConfig(configPath: string = defaultConfigPath): Promise<NormalizedFilterConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as FilterConfig;
    return normalizeConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return FALLBACK_CONFIG;
    }

    throw new Error(`Unable to read filter config at ${configPath}: ${(error as Error)?.message ?? error}`);
  }
}

function normalizeConfig(config: FilterConfig): NormalizedFilterConfig {
  const languages = normalizeStringArray(config.allowedLanguages);
  const categories = normalizeStringArray(config.allowedCategories);

  return {
    allowedLanguages: languages.length > 0 ? languages : FALLBACK_CONFIG.allowedLanguages,
    allowedCategories: categories.length > 0 ? categories : undefined,
  } satisfies NormalizedFilterConfig;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    normalized.push(lower);
  }

  return normalized;
}
