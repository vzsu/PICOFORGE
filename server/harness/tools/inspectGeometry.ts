// server/harness/tools/inspectGeometry.ts — tool 5.4
// LLM_HARNESS §5.4: bbox, volume, section, wall_min, ray

import { err, makeDef, ok, type RunCtx, type ToolModule, z } from "./_base.ts";
import { engineInspectResultSchema, unwrapEngineReply } from "../../engine/client.ts";

const opSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bbox") }),
  z.object({ type: z.literal("volume") }),
  z.object({ type: z.literal("section"), plane: z.enum(["x", "y", "z"]), offset_mm: z.number() }),
  z.object({ type: z.literal("wall_min") }),
  z.object({
    type: z.literal("ray"),
    origin: z.tuple([z.number(), z.number(), z.number()]),
    dir: z.tuple([z.number(), z.number(), z.number()]),
  }),
]);

const zodInput = z.object({
  ops: z.array(opSchema).min(1),
});

type Input = z.infer<typeof zodInput>;

const jsonSchema = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["bbox", "volume", "section", "wall_min", "ray"] },
          plane: { type: "string", enum: ["x", "y", "z"] },
          offset_mm: { type: "number" },
          origin: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          dir: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        },
        required: ["type"],
      },
    },
  },
  required: ["ops"],
};

export const inspectGeometryTool: ToolModule<Input> = {
  name: "inspect_geometry",
  description:
    "Measure the last built geometry. Ops: bbox; volume; section (plane x|y|z at offset mm → returns a slice image and contour count); wall_min (global thin-wall probe); ray (point+dir → hit distance).",
  zodInput,
  jsonSchema,
  def: makeDef(
    "inspect_geometry",
    "Measure the last built geometry. Ops: bbox; volume; section (plane x|y|z at offset mm → returns a slice image and contour count); wall_min (global thin-wall probe); ray (point+dir → hit distance).",
    jsonSchema,
  ),

  async execute(input, ctx: RunCtx) {
    try {
      const parsed = zodInput.safeParse(input);
      if (!parsed.success) {
        return err(new Error(`inspect_geometry validation: ${parsed.error.message}`));
      }

      if (!ctx.lastArtifactId) {
        return ok({
          error: { code: "NO_GEOMETRY", detail: "No geometry available — run run_picogk first" },
        });
      }

      if (!ctx.engineClient?.inspect) {
        return ok({ error: { code: "ENGINE_NOT_READY", detail: "Engine not connected" } });
      }

      const reply = unwrapEngineReply(
        await ctx.engineClient.inspect({ target: ctx.lastArtifactId, ops: parsed.data.ops }),
        "INSPECT_FAILED",
      );
      if (!reply.ok) return ok({ error: reply.error });

      const measured = engineInspectResultSchema.safeParse(reply.value);
      if (!measured.success) {
        return ok({ error: { code: "ENGINE_PROTOCOL", detail: measured.error.message } });
      }
      return ok(measured.data);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  },
};
