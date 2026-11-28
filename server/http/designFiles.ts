// server/http/designFiles.ts — the saved design files of a run (SAVE-RUN-01) and the latest saved
// part of a conversation, so the studio reopens with its last part in the viewport (SAVE-OPEN-01).
// Every build that clears the ladder writes part.stl + report.json (engine) and design.cs +
// brief.json (run_picogk) into <dataDir>/runs/<runId>/.

import { z } from "zod";
import { join } from "jsr:@std/path@^1.0.0";
import { engineStatsSchema } from "../engine/client.ts";

export interface RunFile {
  name: string;
  url: string;
  bytes: number;
}

/** Files a human may download, in a stable order. */
const ORDER = ["design.cs", "brief.json", "part.stl", "report.json"];

export async function listRunFiles(dataDir: string, runId: string): Promise<RunFile[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) return [];
  const dir = join(dataDir, "runs", runId);
  const out: RunFile[] = [];
  const add = async (rel: string) => {
    try {
      const st = await Deno.stat(join(dir, rel));
      if (st.isFile) out.push({ name: rel, url: `/files/runs/${runId}/${rel}`, bytes: st.size });
    } catch { /* not there */ }
  };
  for (const name of ORDER) await add(name);
  try {
    for await (const e of Deno.readDir(join(dir, "exports"))) {
      if (e.isFile && !e.name.startsWith(".")) await add(`exports/${e.name}`);
    }
  } catch { /* no exports yet */ }
  return out;
}

const reportSchema = z.object({ stats: engineStatsSchema }).passthrough();
const briefTitleSchema = z.object({ title: z.string() }).passthrough();

export interface LatestPart {
  runId: string;
  url: string;
  title: string | null;
  savedAt: number;
  stats: { volumeCm3: number; triangles: number; watertight: boolean; material: string | null };
  files: RunFile[];
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

/** The newest run (ids newest first) whose saved mesh and report are on disk. */
export async function latestPart(
  dataDir: string,
  runIdsNewestFirst: string[],
): Promise<LatestPart | null> {
  for (const runId of runIdsNewestFirst) {
    const files = await listRunFiles(dataDir, runId);
    const stl = files.find((f) => f.name === "part.stl");
    if (!stl) continue;
    const report = reportSchema.safeParse(
      await readJson(join(dataDir, "runs", runId, "report.json")),
    );
    if (!report.success) continue;
    const briefRaw = await readJson(join(dataDir, "runs", runId, "brief.json"));
    const brief = briefTitleSchema.safeParse(briefRaw);
    const material = z.object({ material: z.string() }).passthrough().safeParse(briefRaw);
    let savedAt = Date.now();
    try {
      savedAt = (await Deno.stat(join(dataDir, "runs", runId, "part.stl"))).mtime?.getTime() ??
        savedAt;
    } catch { /* keep now */ }
    const s = report.data.stats;
    return {
      runId,
      url: stl.url,
      title: brief.success ? brief.data.title : null,
      savedAt,
      stats: {
        volumeCm3: s.volumeCm3,
        triangles: s.triangles,
        watertight: s.watertight,
        material: material.success ? material.data.material : null,
      },
      files,
    };
  }
  return null;
}
