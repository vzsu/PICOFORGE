// server/tests/secretScan.test.ts — SEC-SCAN-01 (CLAUDE.md rule 7: secrets never in commits)
// Fails if any git-tracked file contains an API-key-shaped string (`sk-…` / `sk-ant-…`, 20+ chars).

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { findSecrets, scanTrackedFiles } from "../../scripts/secret_scan.ts";

// Fixtures are assembled at runtime so this file never contains a key-shaped literal itself.
const PREFIX = "sk-" + "ant-";
const FAKE_ANT = PREFIX + "api03-" + "Zq8xY2kLm4Np6Rs0Tu1Vw3Xy5Ab7Cd9Ef";
const FAKE_OPENAI = "sk-" + "proj-" + "9fJ2kL3mN4pQ5rS6tU7vW8xY";

Deno.test("SEC-SCAN-01: detector flags key-shaped strings", () => {
  assertEquals(findSecrets(`ANTHROPIC_API_KEY=${FAKE_ANT}\n`).length, 1);
  assertEquals(findSecrets(`const k = "${FAKE_OPENAI}";`).length, 1);
  assertEquals(findSecrets(`a\nb ${FAKE_ANT}`)[0].line, 2);
});

Deno.test("SEC-SCAN-01: detector ignores placeholders, short strings, css class names", () => {
  const benign = [
    `ANTHROPIC_API_KEY=${PREFIX}…`,
    `key: "${PREFIX}xxxx"`,
    "sk-short",
    `<div class="ask-user-dialog-container-wrapper-v2">`,
    "task-1234567890123456789012345",
    "risk-assessment-for-the-blade-hub-2026",
    "sk-loading-spinner-container-element",
  ].join("\n");
  assertEquals(findSecrets(benign), []);
});

Deno.test("SEC-SCAN-01: no tracked file contains a key-shaped string", async () => {
  const repoRoot = new URL("../../", import.meta.url);
  const { scanned, findings } = await scanTrackedFiles(repoRoot);
  assertEquals(scanned > 50, true, `only ${scanned} tracked files scanned`);
  assertEquals(findings.map((f) => `${f.file}:${f.line}`), []);
});
