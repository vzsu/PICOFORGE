// app/src/mock/mainScreen.ts
// All mock data for the P0 main-screen mock-up (docs/02 §1, image prompt "1. Main screen").
// No server needed. When the real stores land, these shapes are the contract to replace.

export type RunStatus = "live" | "ok" | "failed" | "idle";

export interface TreeVariant {
  id: string;
  label: string;
  run: string;
  status: RunStatus;
}

export interface TreeProject {
  id: string;
  name: string;
  open: boolean;
  designs: TreeVariant[];
  runsCount: number;
}

export interface PartRow {
  id: string;
  name: string;
  visible: boolean;
}

export interface BriefRow {
  id: string;
  param: string;
  value: string;
  unit: string;
  target?: "up" | "down";
  check?: "ok" | "fail";
}

export interface ChatMessageMock {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
}

export type Mode = "low" | "std" | "deep" | "raman";

export const MODES: readonly Mode[] = ["low", "std", "deep", "raman"];

export const MODE_ESTIMATE: Record<Mode, string> = {
  low: "~0:40 on T0",
  std: "~2:10 on T0",
  deep: "~6:30 on T0",
  raman: "~18 min on T0",
};

export const projects: TreeProject[] = [
  {
    id: "oneshotfly",
    name: "OneShotFly",
    open: true,
    designs: [{ id: "v1.1", label: "v1.1", run: "#1048", status: "live" }],
    runsCount: 12,
  },
  { id: "spacerockets", name: "SpaceRockets", open: false, designs: [], runsCount: 4 },
];

export const parts: PartRow[] = [
  { id: "head", name: "head", visible: true },
  { id: "jacket", name: "water jacket", visible: true },
  { id: "bores", name: "bores", visible: false },
];

export const chatTabs = ["Chat", "Compute", "Logs", "Analytics"] as const;
export type ChatTab = (typeof chatTabs)[number];

export const messages: ChatMessageMock[] = [
  {
    id: "m1",
    role: "user",
    text:
      "Make the V8 head lighter but keep the coolant flow. Aluminium, printable without supports on the deck side.",
    time: "14:02",
  },
  {
    id: "m2",
    role: "assistant",
    text:
      "Here is the brief I will build against. I am keeping bore and valve layout fixed and letting the optimiser thin the walls around the water jacket.",
    time: "14:02",
  },
];

export const briefCategory = "Engine · head";

export const brief: BriefRow[] = [
  { id: "bore", param: "Bore", value: "86.0", unit: "mm" },
  { id: "valves", param: "Valves per cylinder", value: "4", unit: "" },
  { id: "mass", param: "Mass", value: "2.40", unit: "kg", target: "down" },
  { id: "coolant", param: "Coolant flow", value: "18.0", unit: "L/min", target: "up" },
  { id: "wall", param: "Min wall", value: "2.5", unit: "mm", target: "down" },
  { id: "overhang", param: "Overhang ≤ 45°", value: "", unit: "", check: "ok" },
];

export const liveStatus = {
  verb: "Working on",
  phrase: "structural optimisation",
  step: 3,
  steps: 4,
  elapsed: "00:42",
  progress: 0.68,
  done: ["mesh", "cfd"],
};

export const readout = {
  volumeCm3: 412.7,
  massKg: 2.38,
  valid: true,
  stage: "VALIDATED" as const,
};

export const statusBar = {
  saved: "Saved · 2s ago",
  tier: "T0",
  engineOk: true,
  agents: 1,
};

export const composerPlaceholder = "Describe a change…";
