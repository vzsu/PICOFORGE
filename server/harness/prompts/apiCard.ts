// server/harness/prompts/apiCard.ts — the PicoGK + Kit API card the model writes against (docs/13 §5).
// Source of truth: engine/picogk_api.json, produced by engine/tools/DumpApi from the real assemblies.
// Curated: the modelling surface only. File I/O, the viewer, the library lifecycle, slicing and native
// handles are left out; the analyzer rejects them anyway (docs/04 §8), so advertising them only invites
// compile repairs. Loaded once per process; zod-validated.

import { z } from "zod";
import { makeLogger } from "../../log.ts";

const log = makeLogger("harness.prompts.apiCard");

const memberSchema = z.object({ name: z.string(), kind: z.string().optional(), sig: z.string() })
  .passthrough();
const typeSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  namespace: z.string(),
  members: z.array(memberSchema),
}).passthrough();
const manifestSchema = z.object({
  picogkVersion: z.string().optional(),
  types: z.array(typeSchema),
}).passthrough();
export type ApiManifest = z.infer<typeof manifestSchema>;

/** PicoGK types a design may use. Everything else in the kernel stays off the card. */
const PICOGK_TYPES = new Set([
  "Voxels",
  "Mesh",
  "Lattice",
  "BBox3",
  "IImplicit",
  "IBoundedImplicit",
]);
/** Members on those types that touch files, the viewer, slicing or native handles. */
const BANNED_MEMBER =
  /Save|Load|Viewer|File|Cli|Vdb|Csv|Tga|Image|Slice|Handle|Viz|Library|^~|Dispose|Finalize/;

const MANIFEST_URL = new URL("../../../engine/picogk_api.json", import.meta.url);
let cached: Promise<ApiManifest | null> | null = null;

/** The engine's API manifest, or null when DumpApi has not been run (the prompt says so). */
export function loadApiManifest(): Promise<ApiManifest | null> {
  cached ??= (async () => {
    try {
      const parsed = manifestSchema.safeParse(JSON.parse(await Deno.readTextFile(MANIFEST_URL)));
      if (!parsed.success) {
        log.error("picogk_api.json fails its schema", {
          errId: "E-APICARD",
          issue: parsed.error.issues[0],
        });
        return null;
      }
      return parsed.data;
    } catch (e) {
      log.warn("picogk_api.json not readable; run engine/tools/DumpApi", { error: String(e) });
      return null;
    }
  })();
  return cached;
}

/** Render the card for one namespace ("PicoGK" curated, "PicoForge.Kit" whole). */
export function renderApiCard(m: ApiManifest, namespace: "PicoGK" | "PicoForge.Kit"): string {
  const lines: string[] = [];
  for (const t of m.types) {
    if (t.namespace !== namespace) continue;
    if (namespace === "PicoGK" && !PICOGK_TYPES.has(t.name)) continue;
    const members = t.members.filter((mm) =>
      !BANNED_MEMBER.test(mm.name) && !BANNED_MEMBER.test(mm.sig)
    );
    if (members.length === 0) continue;
    lines.push(`### ${t.name}`);
    for (const mm of members) lines.push(`  ${mm.sig}`);
  }
  return lines.join("\n");
}
