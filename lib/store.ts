import { promises as fs } from "fs";
import path from "path";
import { get, put } from "@vercel/blob";
import { Db, emptyDb } from "./types";

/**
 * Persistence layer.
 * - On Vercel (BLOB_READ_WRITE_TOKEN set): a private Vercel Blob store holds one JSON
 *   document with all receipt records plus the original files (PDFs, photos).
 * - Locally without a token: the same layout under ./.data (git-ignored).
 */

const DB_PATH = "expenses/db.json";
const LOCAL_ROOT = path.join(process.cwd(), ".data");

export function storageMode(): "blob" | "local" {
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

async function readBlobBuffer(pathname: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const res = await get(pathname, { access: "private", useCache: false });
  if (!res) return null;
  const buffer = Buffer.from(await new Response(res.stream).arrayBuffer());
  const contentType = res.blob.contentType ?? "application/octet-stream";
  return { buffer, contentType };
}

export async function loadDb(): Promise<Db> {
  if (storageMode() === "blob") {
    const res = await readBlobBuffer(DB_PATH);
    if (!res) return emptyDb();
    return normalize(JSON.parse(res.buffer.toString("utf8")));
  }
  try {
    const raw = await fs.readFile(path.join(LOCAL_ROOT, DB_PATH), "utf8");
    return normalize(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
    throw err;
  }
}

function normalize(db: Partial<Db>): Db {
  const base = emptyDb();
  return {
    version: 1,
    mailboxes: db.mailboxes ?? base.mailboxes,
    lastSync: db.lastSync ?? null,
    receipts: db.receipts ?? {},
    statements: db.statements ?? {},
    fxCache: db.fxCache ?? {},
    customCategories: db.customCategories ?? [],
  };
}

export async function saveDb(db: Db): Promise<void> {
  const body = JSON.stringify(db);
  if (storageMode() === "blob") {
    await put(DB_PATH, body, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
    });
    return;
  }
  const full = path.join(LOCAL_ROOT, DB_PATH);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf8");
}

export async function putFile(pathname: string, buffer: Buffer, contentType: string): Promise<void> {
  if (storageMode() === "blob") {
    await put(pathname, buffer, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType,
    });
    return;
  }
  const full = path.join(LOCAL_ROOT, pathname);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
}

export async function getFile(pathname: string, fallbackType: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (storageMode() === "blob") {
    const res = await readBlobBuffer(pathname);
    if (!res) return null;
    return { buffer: res.buffer, contentType: res.contentType || fallbackType };
  }
  try {
    const buffer = await fs.readFile(path.join(LOCAL_ROOT, pathname));
    return { buffer, contentType: fallbackType };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 80) || "file";
}
