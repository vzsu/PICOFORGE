// server/harness/validate.ts — L3 geometry checks on engine build stats
// 13 §7 (validation ladder, L3 rung) · archive LLM_HARNESS §7 · failure F4 in 04 §7:
// "Geometry invalid (empty, leaky, too thin, outside envelope) → repair with measured numbers".
//
// Pure function: engine stats + accepted brief in, Result out. Every failure carries the measured
// and required numbers so the repair message can quote them.

import { err, ok, type Result } from "../domain/result.ts";
import type { EngineStats } from "../engine/client.ts";
import type { AcceptedBrief } from "./tools/_base.ts";

export type GeometryCheckCode =
  | "EMPTY_GEOMETRY"
  | "NOT_WATERTIGHT"
  | "ENVELOPE_EXCEEDED"
  | "BELOW_MIN_WALL"
  | "TRIANGLE_COUNT";

type Numbers = Record<string, number | boolean>;

export interface GeometryFailure {
  code: GeometryCheckCode;
  /** One plain sentence with the numbers, e.g. "min wall 0.42 mm < required 1.5 mm (…)". */
  message: string;
  measured: Numbers;
  required: Numbers;
}

export interface GeometryInvalid {
  /** Headline code (first failure) — drives the repair budget. */
  code: GeometryCheckCode;
  failures: GeometryFailure[];
}

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Below this the part is considered empty (LLM_HARNESS §7: volume < 0.01 cm³). */
export const EMPTY_VOLUME_CM3 = 0.01;
/** bbox may exceed the brief envelope by 10 % per axis (LLM_HARNESS §7). */
export const ENVELOPE_TOLERANCE = 1.1;
/** Mesh sanity cap: above this the viewport and exports degrade badly on T0 (04 §6). */
export const MAX_TRIANGLES = 10_000_000;
/** Print minimum is at least this many voxels thick (PICOGK_KNOWLEDGE "Print minimums"). */
export const MIN_WALL_VOXELS = 3;
/** Warn when the measured wall is within 20 % of the requirement (LLM_HARNESS §7). */
const MIN_WALL_WARN_MARGIN = 1.2;

/** Material minimum wall, mm — mirrors `Material` presets in engine Kit/Ctx.cs. */
export const MATERIAL_MIN_WALL_MM: Readonly<Record<string, number>> = {
  "PLA": 1.0,
  "PETG": 1.0,
  "ABS": 1.2,
  "PA12": 0.8,
  "Resin": 0.6,
  "Al6061-T6": 0.8,
  "SS316L": 0.5,
};

/** Brief parameter names that state a minimum wall (mm). */
const MIN_WALL_PARAM_NAMES = new Set(["min_wall", "min_wall_mm", "wall_thickness_min"]);

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Required minimum wall = max(material minimum, brief min-wall parameter, 3 × voxel). */
export function requiredMinWallMm(
  brief: AcceptedBrief | undefined,
  voxelSizeMm: number,
): { requiredMm: number; sources: string[] } {
  const candidates: Array<[string, number]> = [
    [`${MIN_WALL_VOXELS}×voxel ${r2(voxelSizeMm)} mm`, MIN_WALL_VOXELS * voxelSizeMm],
  ];
  const mat = brief ? MATERIAL_MIN_WALL_MM[brief.material] : undefined;
  if (brief && mat !== undefined) candidates.push([`material ${brief.material}`, mat]);
  for (const p of brief?.parameters ?? []) {
    if (p.unit === "mm" && MIN_WALL_PARAM_NAMES.has(p.name)) {
      candidates.push([`brief ${p.name}`, p.value]);
    }
  }
  const requiredMm = r2(Math.max(...candidates.map(([, v]) => v)));
  return {
    requiredMm,
    sources: candidates.map(([label, v]) => `${label} ${r2(v)} mm`),
  };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export function validateGeometry(
  stats: EngineStats,
  brief: AcceptedBrief | undefined,
): Result<{ warnings: string[] }, GeometryInvalid> {
  const failures: GeometryFailure[] = [];
  const warnings: string[] = [];

  // 1. Non-empty volume
  if (stats.volumeCm3 < EMPTY_VOLUME_CM3) {
    failures.push({
      code: "EMPTY_GEOMETRY",
      message: `volume ${stats.volumeCm3} cm³ < ${EMPTY_VOLUME_CM3} cm³ — the part is empty`,
      measured: { volumeCm3: stats.volumeCm3 },
      required: { volumeCm3: EMPTY_VOLUME_CM3 },
    });
  }

  // 2. Watertight mesh
  if (!stats.watertight) {
    failures.push({
      code: "NOT_WATERTIGHT",
      message: "mesh is not watertight (open edges after meshing)",
      measured: { watertight: false },
      required: { watertight: true },
    });
  }

  // 3. bbox inside brief envelope × tolerance, per axis
  if (brief) {
    const measured: Numbers = {};
    const required: Numbers = {};
    const parts: string[] = [];
    (["x", "y", "z"] as const).forEach((ax, i) => {
      const extent = r2(stats.bboxMax[i] - stats.bboxMin[i]);
      const limit = r2(brief.envelope_mm[ax] * ENVELOPE_TOLERANCE);
      if (extent > limit) {
        measured[`${ax}Mm`] = extent;
        required[`${ax}Mm`] = limit;
        parts.push(`${ax} ${extent} mm > ${limit} mm (+${r2(extent - limit)} mm)`);
      }
    });
    if (parts.length > 0) {
      failures.push({
        code: "ENVELOPE_EXCEEDED",
        message: `bbox exceeds brief envelope × ${ENVELOPE_TOLERANCE}: ${parts.join(", ")}`,
        measured,
        required,
      });
    }
  }

  // 4. Minimum wall
  const wall = requiredMinWallMm(brief, stats.voxelSizeMm);
  const measuredWall = r2(stats.minWallProbeMm);
  if (measuredWall < wall.requiredMm) {
    failures.push({
      code: "BELOW_MIN_WALL",
      message: `min wall ${measuredWall} mm < required ${wall.requiredMm} mm (${
        wall.sources.join(", ")
      })`,
      measured: { minWallMm: measuredWall },
      required: { minWallMm: wall.requiredMm },
    });
  } else if (measuredWall < wall.requiredMm * MIN_WALL_WARN_MARGIN) {
    warnings.push(`min wall ${measuredWall} mm is within 20 % of required ${wall.requiredMm} mm`);
  }

  // 5. Triangle count sane
  if (stats.triangles <= 0 || stats.triangles > MAX_TRIANGLES) {
    failures.push({
      code: "TRIANGLE_COUNT",
      message: `mesh has ${stats.triangles} triangles; expected 1…${MAX_TRIANGLES}`,
      measured: { triangles: stats.triangles },
      required: { minTriangles: 1, maxTriangles: MAX_TRIANGLES },
    });
  }

  if (failures.length > 0) return err({ code: failures[0].code, failures });
  return ok({ warnings });
}
