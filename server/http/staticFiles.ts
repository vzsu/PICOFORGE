// server/http/staticFiles.ts — Artifact file serving
// SYS_DESIGN §3.2: /files/* → artifact dir, with ETag + Range support

import { makeLogger } from "../log.ts";
import { isAbsolute, relative, resolve } from "jsr:@std/path@^1.0.0";
import { getConfig } from "../config.ts";
import type { Context } from "hono";

const log = makeLogger("static");

const MIME: Record<string, string> = {
  stl: "model/stl",
  glb: "model/gltf-binary",
  vdb: "application/octet-stream",
  png: "image/png",
  json: "application/json",
  "3mf": "model/3mf",
};

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "cs") return "text/plain; charset=utf-8";
  return MIME[ext] ?? "application/octet-stream";
}

/** Build outputs only (design code, brief, report, meshes, captures). */
const SERVABLE_EXT = new Set(["stl", "glb", "3mf", "vdb", "png", "json", "cs"]);

/**
 * B-014 (SEC-FILES-01): /files/* has no token (the viewport fetches meshes by URL), so it may serve
 * only build outputs: a resolved path inside <dataDir>/runs/, no dot-files, allowed extensions.
 * Returns the absolute path, or null. Before this, secret.env and the DB were served.
 */
export function resolveServable(dataDir: string, relPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(relPath).replaceAll("\\", "/");
  } catch {
    return null;
  }
  const root = resolve(dataDir, "runs");
  const abs = resolve(dataDir, rel);
  const inside = relative(root, abs);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return null;
  const parts = inside.replaceAll("\\", "/").split("/");
  if (parts.some((p) => p.startsWith("."))) return null;
  const ext = parts.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  return SERVABLE_EXT.has(ext) ? abs : null;
}

/** GET /files/:path* — serve build outputs from DATA_DIR/runs */
export async function serveFile(c: Context): Promise<Response> {
  const config = getConfig();
  const relPath = c.req.param("path");
  if (!relPath) return c.json({ error: { code: "NOT_FOUND", message: "No path" } }, 404);

  const absPath = resolveServable(config.DATA_DIR, relPath);
  if (!absPath) {
    log.warn("refused /files request outside run outputs");
    return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }

  try {
    const stat = await Deno.stat(absPath);
    if (!stat.isFile) {
      return c.json({ error: { code: "NOT_FOUND", message: "Not a file" } }, 404);
    }

    const etag = `"${stat.size}-${stat.mtime?.getTime() ?? 0}"`;
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    const rangeHeader = c.req.header("range");
    const contentType = mimeFor(absPath);

    if (rangeHeader) {
      // Range request
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        return c.json({ error: { code: "BAD_RANGE", message: "Invalid Range header" } }, 416);
      }
      const start = match[1] ? parseInt(match[1]) : 0;
      const end = match[2] ? parseInt(match[2]) : stat.size - 1;
      const chunkSize = end - start + 1;

      const file = await Deno.open(absPath);
      await file.seek(start, Deno.SeekMode.Start);
      const buf = new Uint8Array(chunkSize);
      await file.read(buf);
      file.close();

      return new Response(buf, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(chunkSize),
          ETag: etag,
          "Accept-Ranges": "bytes",
        },
      });
    }

    // Full file
    const data = await Deno.readFile(absPath);
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        ETag: etag,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return c.json({ error: { code: "NOT_FOUND", message: "File not found" } }, 404);
    }
    const errId = crypto.randomUUID();
    log.error("File serve error", { errId, path: absPath, error: String(e) });
    return c.json({ error: { code: "INTERNAL", message: "File read error", errId } }, 500);
  }
}
