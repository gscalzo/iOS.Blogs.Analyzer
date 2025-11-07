import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { BlogsDirectory } from "./types.js";

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

  return parsed as BlogsDirectory;
}

export interface ExtractFeedUrlsOptions {
  maxBlogs?: number;
  language?: string;
}

export function extractFeedUrls(blogs: BlogsDirectory, options: ExtractFeedUrlsOptions = {}): string[] {
  const { maxBlogs, language } = options;

  if (maxBlogs !== undefined) {
    if (!Number.isInteger(maxBlogs) || maxBlogs < 0) {
      throw new RangeError("maxBlogs must be a non-negative integer when provided");
    }
  }

  const feeds: string[] = [];

  for (const group of blogs) {
    if (language && group.language !== language) {
      continue;
    }

    for (const category of group.categories) {
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
