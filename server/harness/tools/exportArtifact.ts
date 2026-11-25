// server/harness/tools/exportArtifact.ts — tool 5.6
// LLM_HARNESS §5.6: export geometry for user (STL, 3MF, GLB, VDB, CLI)

import { err, makeDef, ok, type RunCtx, runFolder, type ToolModule, z } from "./_base.ts";
import { engineExportResultSchema, unwrapEngineReply } from "../../engine/client.ts";

/**
 * Model-supplied filename → a bare, safe name with the right extension.
 * Directory parts and anything outside [A-Za-z0-9._-] are dropped, so the file always
 * lands directly in the run's exports folder.
 */
function safeFilename(filename: string | undefined, format: string, runId: string): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return `${stem || `part_${runId.slice(-8)}`}.${format}`;
}

const zodInput = z.object({
  format: z.enum(["stl", "3mf", "glb", "vdb", "cli"]),
  filename: z.string().max(128).optional(),
});

type Input = z.infer<typeof zodInput>;

const jsonSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["stl", "3mf", "glb", "vdb", "cli"] },
    filename: { type: "string" },
  },
  required: ["format"],
};

export const exportArtifactTool: ToolModule<Input> = {
  name: "export_artifact",
  description:
    "Export the current geometry for the user. Only call when the user asks for a file/download/print.",
  zodInput,
  jsonSchema,
  def: makeDef(
    "export_artifact",
    "Export the current geometry for the user. Only call when the user asks for a file/download/print.",
    jsonSchema,
  ),

  async execute(input, ctx: RunCtx) {
    try {
      const parsed = zodInput.safeParse(input);
      if (!parsed.success) {
        return err(new Error(`export_artifact validation: ${parsed.error.message}`));
      }
      const { format, filename } = parsed.data;

      if (!ctx.lastArtifactId) {
        return ok({
          error: { code: "NO_GEOMETRY", detail: "No geometry to export — run run_picogk first" },
        });
      }

      const name = safeFilename(filename, format, ctx.runId);

      if (!ctx.engineClient?.export) {
        return ok({ error: { code: "ENGINE_NOT_READY", detail: "Engine not connected" } });
      }

      // The engine writes the file; the harness only picks where (inside the run folder).
      const relPath = `runs/${ctx.runId}/exports/${name}`;
      const exportDir = `${runFolder(ctx)}/exports`;
      const outPath = `${exportDir}/${name}`;
      await Deno.mkdir(exportDir, { recursive: true });

      const reply = unwrapEngineReply(
        await ctx.engineClient.export({ target: ctx.lastArtifactId, format, outPath }),
        "EXPORT_FAILED",
      );
      if (!reply.ok) return ok({ error: reply.error });

      const written = engineExportResultSchema.safeParse(reply.value);
      if (!written.success) {
        return ok({ error: { code: "ENGINE_PROTOCOL", detail: written.error.message } });
      }

      // Trust the disk, not the reply: the file must exist where we asked for it.
      const stat = await Deno.stat(outPath).catch(() => null);
      if (!stat?.isFile) {
        return ok({
          error: {
            code: "EXPORT_MISSING",
            detail: `engine reported ${outPath} but no file exists`,
          },
        });
      }

      return ok({
        filename: name,
        format,
        bytes: stat.size,
        url: `/files/${relPath}`,
        message: `Ready: ${name}`,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  },
};
