// server/harness/mock/fanModel.ts — scripted "model" for the running server (PICOFORGE_MODEL=mock).
// docs/11 §5 mock model. It answers any prompt as a fan-impeller request: brief → run_picogk →
// summary, with realistic token timing, so the real engine builds a real part with no network,
// no key and no cost. Stateless: the turn is derived from the message history, so concurrent
// runs and repeated prompts work.

import { z } from "zod";
import type { AnthropicMessage, StreamCallbacks, TurnResult } from "../anthropic.ts";
import { streamScriptedTurn, type ScriptedTurn } from "./scriptedStream.ts";

/** Env switch read by anthropic.ts. */
export function isMockModel(): boolean {
  return Deno.env.get("PICOFORGE_MODEL") === "mock";
}

/** Tokens per second for the mock stream (PICOFORGE_MOCK_TPS, default 200 ≈ a fast hosted model). */
export function mockTokensPerSecond(): number {
  const raw = Number(Deno.env.get("PICOFORGE_MOCK_TPS") ?? "200");
  return Number.isFinite(raw) && raw >= 0 ? raw : 200;
}

// ─── Prompt → fan parameters ────────────────────────────────────────────────

const MATERIALS = ["PLA", "PETG", "ABS", "PA12", "Resin", "Al6061-T6", "SS316L"] as const;

export interface FanSpec {
  diameterMm: number;
  blades: number;
  hubDiameterMm: number;
  material: string;
}

const DEFAULT_FAN: FanSpec = { diameterMm: 120, blades: 7, hubDiameterMm: 25, material: "PLA" };

/** Pull diameter, blade count, hub and material out of a plain-language fan prompt. */
export function parseFanPrompt(text: string): FanSpec {
  const num = (re: RegExp): number | undefined => {
    const m = text.match(re);
    const v = m ? Number(m[1]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const diameterMm = num(/(\d+(?:\.\d+)?)\s*mm\s+(?:\w+\s+){0,2}(?:fan|impeller|rotor)/i);
  const blades = num(/(\d+)\s+(?:[\w-]+\s+){0,2}blades?/i);
  const hubDiameterMm = num(/(\d+(?:\.\d+)?)\s*mm\s+hub/i);
  const material = MATERIALS.find((m) => new RegExp(`\\b${m}\\b`, "i").test(text));
  return {
    diameterMm: clamp(diameterMm ?? DEFAULT_FAN.diameterMm, 40, 300),
    blades: Math.round(clamp(blades ?? DEFAULT_FAN.blades, 2, 16)),
    hubDiameterMm: clamp(hubDiameterMm ?? DEFAULT_FAN.hubDiameterMm, 10, 80),
    material: material ?? DEFAULT_FAN.material,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Brief and code ─────────────────────────────────────────────────────────

const RPM = 1800;
const AXIAL_VELOCITY_MPS = 4.9;
const HUB_HEIGHT_MM = 24;
const BORE_RADIUS_MM = 2.5;
const VOXEL_MM = 0.5;

/** A brief that the real validator accepts for a rotor_fan (docs/13 §3, submitDesignBrief.ts). */
export function fanBrief(spec: FanSpec) {
  const tipR = spec.diameterMm / 2 - 0.5;
  const hubR = spec.hubDiameterMm / 2;
  const omega = (RPM * 2 * Math.PI) / 60;
  const tipSpeed = omega * tipR / 1000;
  const midR = (hubR + tipR) / 2;
  const chordMid = 22;
  const solidity = (spec.blades * chordMid) / (2 * Math.PI * midR);
  return {
    title: `${spec.diameterMm} mm fan impeller, ${spec.blades} blades`,
    category: "rotor_fan" as const,
    requirements: [
      `${spec.diameterMm} mm outer diameter`,
      `${spec.blades} blades`,
      `${spec.hubDiameterMm} mm hub`,
      `${spec.material}, FDM printable`,
    ],
    parameters: [
      { name: "tip_radius", value: r2(tipR), unit: "mm", rationale: "0.5 mm tip clearance" },
      { name: "hub_radius", value: r2(hubR), unit: "mm", rationale: "requested hub" },
      { name: "blade_count", value: spec.blades, unit: "count", rationale: "requested" },
      { name: "hub_height", value: HUB_HEIGHT_MM, unit: "mm", rationale: "blade root support" },
      { name: "bore_radius", value: BORE_RADIUS_MM, unit: "mm", rationale: "5 mm motor shaft" },
      { name: "rpm", value: RPM, unit: "rpm", rationale: "typical 12 V fan motor" },
      {
        name: "axial_velocity",
        value: AXIAL_VELOCITY_MPS,
        unit: "mps",
        rationale: "design flow point",
      },
    ],
    physics_checks: [
      {
        name: "tip_speed",
        formula: "v = ω·r_tip",
        computed: r2(tipSpeed),
        limit: 60,
        pass: tipSpeed < 60,
      },
      {
        name: "centrifugal_stress_sf",
        formula: "SF = σ_y / (ρ·v²/2)",
        computed: 25,
        limit: 2,
        pass: true,
      },
      {
        name: "solidity",
        formula: "σ = B·c / (2π·r_mid)",
        computed: r2(solidity),
        limit: 1.5,
        pass: solidity < 1.5,
      },
      {
        name: "min_blade_thickness",
        formula: "t = 0.09·c_tip",
        computed: 1.62,
        limit: 1.5,
        pass: true,
      },
    ],
    envelope_mm: { x: spec.diameterMm, y: spec.diameterMm, z: 40 },
    voxel_size_mm: VOXEL_MM,
    material: spec.material,
    assumptions: ["Free-vortex blade twist, NACA 4409 sections", "Axial inflow, no inlet guide vanes"],
    risks: ["Thin trailing edge near the tip prints best with 0.4 mm nozzle"],
  };
}

/** Fan impeller under the v1 code contract; every dimension comes from the brief via ctx.P. */
export const FAN_CODE = `using System;
using System.Numerics;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    // beta(r) = atan(c_a / (omega * r)) + 4 deg incidence (free vortex)
    public static Voxels voxBuild(Ctx ctx)
    {
        float fHubR = ctx.P("hub_radius");
        float fTipR = ctx.P("tip_radius");
        int nB = ctx.Pi("blade_count");
        float fCa = ctx.P("axial_velocity");
        float fOmega = ctx.P("rpm") * 2f * MathF.PI / 60f;
        float fHubH = ctx.P("hub_height");
        float fBore = ctx.P("bore_radius");

        var spec = new BladeSpec(
            fHubR: fHubR - 0.5f, fTipR: fTipR, nSections: 7,
            fChordAt: r => 26f - 8f * r,
            fBetaDegAt: r =>
            {
                float fRad = (fHubR + r * (fTipR - fHubR)) / 1000f;
                return MathF.Atan2(fCa, fOmega * fRad) * 180f / MathF.PI + 4f;
            },
            sNacaAt: _ => "4409");
        ctx.Log($"rotor: {nB} blades");
        return Kit.voxAxialRotor(ctx, spec, nB, fHubR: fHubR, fHubZ0: 0, fHubZ1: fHubH, fBoreR: fBore, fFilletR: 1.2f);
    }
}
`;

// ─── History → turn ─────────────────────────────────────────────────────────

const toolResultJson = z.object({}).passthrough();

/** The prompt (last user text) and the tool results the model has seen since it. */
function readHistory(messages: AnthropicMessage[]): {
  prompt: string;
  turn: number;
  lastToolResult: string | null;
} {
  let promptIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && m.content.some((c) => c.type === "text")) {
      promptIdx = i;
      break;
    }
  }
  const prompt = promptIdx >= 0
    ? messages[promptIdx].content.map((c) => (c.type === "text" ? c.text : "")).join(" ")
    : "";
  const after = messages.slice(promptIdx + 1);
  const turn = after.filter((m) => m.role === "assistant").length;
  let lastToolResult: string | null = null;
  const last = after.at(-1);
  if (last?.role === "user") {
    for (const c of last.content) {
      if (c.type === "tool_result") {
        lastToolResult = c.content.map((x) => (x.type === "text" ? x.text : "")).join("");
      }
    }
  }
  return { prompt, turn, lastToolResult };
}

function parseResult(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = toolResultJson.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // repair hints are prose, not JSON
  }
}

const buildOkSchema = z.object({
  ok: z.literal(true),
  stats: z.object({
    volumeCm3: z.number(),
    triangles: z.number(),
    watertight: z.boolean(),
    bboxMin: z.tuple([z.number(), z.number(), z.number()]),
    bboxMax: z.tuple([z.number(), z.number(), z.number()]),
  }).passthrough(),
}).passthrough();

/** Pick the scripted turn for this point in the conversation. */
export function fanTurn(messages: AnthropicMessage[]): ScriptedTurn {
  const { prompt, turn, lastToolResult } = readHistory(messages);
  const spec = parseFanPrompt(prompt);

  if (turn === 0) {
    return {
      text: `Setting up a ${spec.diameterMm} mm impeller with ${spec.blades} blades on a ` +
        `${spec.hubDiameterMm} mm hub in ${spec.material}. Blade angles follow a free-vortex ` +
        `twist at ${RPM} rpm. Here is the brief I will build against.`,
      tools: [{ id: "mock_brief_1", name: "submit_design_brief", input: fanBrief(spec) }],
    };
  }

  const result = parseResult(lastToolResult);

  if (turn === 1) {
    if (result?.accepted !== true) {
      return { text: `The brief was not accepted: ${lastToolResult ?? "no result"}` };
    }
    return {
      text: "Brief accepted. Writing the impeller code and building it.",
      tools: [{
        id: "mock_build_1",
        name: "run_picogk",
        input: { code: FAN_CODE, notes: "initial" },
      }],
    };
  }

  const built = buildOkSchema.safeParse(result);
  if (built.success) {
    const s = built.data.stats;
    const dx = r1(s.bboxMax[0] - s.bboxMin[0]);
    const dy = r1(s.bboxMax[1] - s.bboxMin[1]);
    const dz = r1(s.bboxMax[2] - s.bboxMin[2]);
    return {
      text: `Built and validated: ${r1(s.volumeCm3)} cm³, ${dx} × ${dy} × ${dz} mm, ` +
        `${s.watertight ? "watertight" : "not watertight"}, ${s.triangles.toLocaleString("en-US")} ` +
        "triangles.",
    };
  }
  return { text: `The build did not pass: ${(lastToolResult ?? "no result").slice(0, 400)}` };
}

/** Drop-in for createMessageStream when PICOFORGE_MODEL=mock. Never throws except on cancel. */
export async function mockFanStream(
  args: { messages: AnthropicMessage[]; signal?: AbortSignal },
  callbacks?: StreamCallbacks,
): Promise<TurnResult> {
  const turn = fanTurn(args.messages);
  return await streamScriptedTurn(turn, {
    tokensPerSecond: mockTokensPerSecond(),
    signal: args.signal,
    inputTokens: 0,
  }, callbacks);
}
