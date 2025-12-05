#!/usr/bin/env node
import { access, constants, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOGS_URL = "https://raw.githubusercontent.com/daveverwer/iOSDevDirectory/refs/heads/main/blogs.json";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEST_PATH = path.join(ROOT_DIR, "blogs.json");
const FALLBACK_PATH = path.join(ROOT_DIR, "tests/fixtures/blogs-mini.json");

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function download() {
  if (process.env.IOS_BLOGS_SKIP_DOWNLOAD === "1") {
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(BLOGS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const payload = await response.text();
    await writeFile(DEST_PATH, payload, "utf8");
    console.log(`Downloaded blogs directory to ${DEST_PATH}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (await fileExists(DEST_PATH)) {
      console.warn(`Warning: unable to refresh blogs directory (${reason}); using existing file.`);
      return;
    }
    console.warn(`Warning: unable to download blogs directory (${reason}); falling back to seed data.`);
    const fallback = await readFile(FALLBACK_PATH, "utf8");
    await writeFile(DEST_PATH, fallback, "utf8");
  } finally {
    clearTimeout(timer);
  }
}

await download();
