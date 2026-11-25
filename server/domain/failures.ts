// server/domain/failures.ts — error code → failure-table row (04 §7, CLAUDE.md rule 3)
// Every typed error code the server emits must appear here; FAIL-MAP-01 enforces it.

export type FailureRow =
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7"
  | "F8"
  | "F9"
  | "F10"
  | "F11"
  | "F12"
  | "F13"
  | "F14"
  | "F15"
  | "F16";

export const FAILURE_ROW: Readonly<Record<string, FailureRow>> = {
  // F1 generated code fails lint/compile (L0, L1)
  CONTRACT_VIOLATION: "F1",
  BANNED_API: "F1",
  UNKNOWN_SYMBOL: "F1",
  BRIEF_USER_REGION: "F1",
  COMPILE_ERROR: "F1",
  // F2 exception during build (L2)
  RUNTIME_ERROR: "F2",
  // F3 native crash, out of memory, timeout (L2)
  TIMEOUT: "F3",
  OOM: "F3",
  SANDBOX_CRASH: "F3",
  // F4 geometry invalid (L3)
  EMPTY_GEOMETRY: "F4",
  NOT_WATERTIGHT: "F4",
  ENVELOPE_EXCEEDED: "F4",
  BELOW_MIN_WALL: "F4",
  BRIEF_MISMATCH: "F4",
  PIN_VIOLATED: "F4",
  TRIANGLE_COUNT: "F4",
  // F5 engine host down / not connected
  ENGINE_NOT_READY: "F5",
  ENGINE_LOST: "F5",
  SANDBOX_UNAVAILABLE: "F5",
  // F6 model API error
  ANTHROPIC_ERROR: "F6",
  // F15 engine reply malformed or inconsistent; engine op outside a build fails
  ENGINE_PROTOCOL: "F15",
  INSPECT_FAILED: "F15",
  EXPORT_FAILED: "F15",
  EXPORT_MISSING: "F15",
  // F16 agent tool misuse (out of order, over budget)
  NO_GEOMETRY: "F16",
  TOOL_BUDGET: "F16",
};

export function failureRow(code: string): FailureRow | undefined {
  return FAILURE_ROW[code];
}
