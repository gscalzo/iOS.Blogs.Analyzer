import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { BlogsDirectory, BlogSite } from "./types.js";

export type BlogDataErrorKind = "read-error" | "parse-error" | "validation-error";

export class BlogDataError extends Error {
  constructor(message: string, public readonly kind: BlogDataErrorKind, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlogDataError";
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultBlogsPath = path.resolve(__dirname, "../blogs.json");
const defaultSchemaPath = path.resolve(__dirname, "../schema_blogs.json");

const validatorCache = new Map<string, ValidateFunction<BlogsDirectory>>();

export interface LoadBlogsOptions {
  filePath?: string;
  schemaPath?: string;
}

export async function loadBlogs(options: LoadBlogsOptions = {}): Promise<BlogsDirectory> {
  const { filePath = defaultBlogsPath, schemaPath } = options;

  let rawContents: string;
  try {
    rawContents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new BlogDataError(`Unable to read blogs file at ${filePath}`, "read-error", { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContents) as unknown;
  } catch (error) {
    throw new BlogDataError(`Unable to parse blogs file at ${filePath}`, "parse-error", { cause: error });
  }

  const validator = getValidator(schemaPath ?? defaultSchemaPath);
  if (!validator(parsed)) {
    const message = validator.errors?.map((err) => `${err.instancePath || "/"} ${err.message ?? "is invalid"}`).join("; ") ||
      "Blogs file failed schema validation";
    throw new BlogDataError(message, "validation-error");
  }

  return normalizeBlogsDirectory(parsed as BlogsDirectory);
}

export interface ExtractFeedUrlsOptions {
  maxBlogs?: number;
  language?: string;
  languages?: readonly string[];
  categories?: readonly string[];
}

export function extractFeedUrls(blogs: BlogsDirectory, options: ExtractFeedUrlsOptions = {}): string[] {
  const { maxBlogs, language, languages, categories } = options;

  if (maxBlogs !== undefined) {
    if (!Number.isInteger(maxBlogs) || maxBlogs < 0) {
      throw new RangeError("maxBlogs must be a non-negative integer when provided");
    }
  }

  const feeds: string[] = [];
  const languageFilter = createNormalizedSet(languages ?? (language ? [language] : undefined));
  const categoryFilter = createNormalizedSet(categories);

  for (const group of blogs) {
    const groupLanguage = typeof group.language === "string" ? group.language.toLowerCase() : "";
    if (languageFilter && !languageFilter.has(groupLanguage)) {
      continue;
    }

    for (const category of group.categories) {
      const categoryTitle = typeof category.title === "string" ? category.title.toLowerCase() : "";
      if (categoryFilter && !categoryFilter.has(categoryTitle)) {
        continue;
      }

      for (const site of category.sites) {
        feeds.push(site.feed_url);
        if (maxBlogs !== undefined && feeds.length >= maxBlogs) {
          return feeds;
        }
      }
    }
  }

  return feeds;
}

function getValidator(schemaPath: string): ValidateFunction<BlogsDirectory> {
  const existing = validatorCache.get(schemaPath);
  if (existing) {
    return existing;
  }

  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Parameters<Ajv["compile"]>[0];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validator = ajv.compile<BlogsDirectory>(schema);
  validatorCache.set(schemaPath, validator);
  return validator;
}

function normalizeBlogsDirectory(directory: BlogsDirectory): BlogsDirectory {
  return directory.map((group) => ({
    ...group,
    categories: group.categories.map((category) => ({
      ...category,
      sites: category.sites.map((site) => normalizeSiteUrls(site)),
    })),
  }));
}

const URL_WITH_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

function ensureHttpsScheme(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  if (URL_WITH_SCHEME_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return `https://${trimmed}`;
}

function normalizeSiteUrls(site: BlogSite): BlogSite {
  const normalized: BlogSite = { ...site };

  for (const key of Object.keys(site) as Array<keyof BlogSite>) {
    if (!key.endsWith("_url")) {
      continue;
    }

    const value = site[key];
    if (typeof value === "string") {
      normalized[key] = ensureHttpsScheme(value);
    }
  }

  return normalized;
}

function createNormalizedSet(values?: readonly string[]): Set<string> | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const set = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    set.add(trimmed.toLowerCase());
  }
  return set.size > 0 ? set : undefined;
}
