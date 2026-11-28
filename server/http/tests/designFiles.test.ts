// SAVE-OPEN-01: the latest saved part of a conversation is found on disk (newest run with a mesh and
// a report), with its downloadable files; runs without a saved mesh are skipped.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { latestPart, listRunFiles } from "../designFiles.ts";

const stats = {
  volumeCm3: 14.1,
  bboxMin: [-55, -55, 0],
  bboxMax: [55, 55, 3],
  triangles: 90_000,
  watertight: true,
  voxelSizeMm: 0.25,
  minWallProbeMm: 1.6,
};

Deno.test("SAVE-OPEN-01 latest saved part: newest run with mesh + report, files listed", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pf_save_" });
  const run = async (id: string, withStl: boolean) => {
    const d = join(dir, "runs", id);
    await Deno.mkdir(join(d, "exports"), { recursive: true });
    if (withStl) await Deno.writeFile(join(d, "part.stl"), new Uint8Array(84));
    await Deno.writeTextFile(join(d, "report.json"), JSON.stringify({ ok: true, stats }));
    await Deno.writeTextFile(join(d, "design.cs"), "public static class Design {}");
    await Deno.writeTextFile(
      join(d, "brief.json"),
      JSON.stringify({ title: `frame ${id}`, material: "CF_3K_PLATE" }),
    );
    await Deno.writeFile(join(d, "exports", "frame.3mf"), new Uint8Array(10));
  };
  await run("older", true);
  await run("newest", false); // failed build: no mesh

  const p = await latestPart(dir, ["newest", "older", "missing"]);
  assert(p);
  assertEquals(p.runId, "older");
  assertEquals(p.url, "/files/runs/older/part.stl");
  assertEquals(p.title, "frame older");
  assertEquals(p.stats, {
    volumeCm3: 14.1,
    triangles: 90_000,
    watertight: true,
    material: "CF_3K_PLATE",
  });
  assertEquals(p.files.map((f) => f.name), [
    "design.cs",
    "brief.json",
    "part.stl",
    "report.json",
    "exports/frame.3mf",
  ]);

  assertEquals(await listRunFiles(dir, "../secret"), []); // ids only
  assertEquals(await latestPart(dir, ["newest"]), null);
});
