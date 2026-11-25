// scripts/secret_scan.ts — SEC-SCAN-01: no API-key-shaped strings in tracked files
// CLAUDE.md rule 7. Run directly: `deno run --allow-read --allow-run=git scripts/secret_scan.ts`
// (exit 1 on findings). The test in server/tests/secretScan.test.ts runs the same scan.

export interface SecretFinding {
  file: string;
  line: number;
  /** Redacted: first 10 chars only — the scanner never echoes a key. */
  preview: string;
}

/**
 * `sk-` or `sk-ant-` at a word start, followed by 20+ key characters that include both a letter
 * and a digit. Excludes placeholders (`sk-ant-…`), short strings, words ending in "sk"
 * (`ask-user`, `task-…`, `risk-…`) and digit-free kebab-case class names.
 */
const KEY_RE = /(?<![A-Za-z0-9_-])sk-(?:ant-)?([A-Za-z0-9_-]{20,})/g;

function looksLikeKey(body: string): boolean {
  return /[0-9]/.test(body) && /[A-Za-z]/.test(body) && /[A-Z]|[0-9]{3,}/.test(body);
}

export function findSecrets(text: string, file = "<text>"): SecretFinding[] {
  const out: SecretFinding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(KEY_RE)) {
      if (looksLikeKey(m[1])) out.push({ file, line: i + 1, preview: `${m[0].slice(0, 10)}…` });
    }
  });
  return out;
}

const MAX_BYTES = 2_000_000;

/** Scan every git-tracked file under `repoRoot` (binary and huge files skipped). */
export async function scanTrackedFiles(
  repoRoot: URL,
): Promise<{ scanned: number; findings: SecretFinding[] }> {
  const ls = await new Deno.Command("git", {
    args: ["ls-files", "-z"],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!ls.success) throw new Error(`git ls-files failed: ${new TextDecoder().decode(ls.stderr)}`);

  const files = new TextDecoder().decode(ls.stdout).split("\0").filter((f) => f.length > 0);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const findings: SecretFinding[] = [];
  let scanned = 0;
  for (const file of files) {
    const url = new URL(file, repoRoot);
    const stat = await Deno.stat(url).catch(() => null);
    if (!stat?.isFile || stat.size > MAX_BYTES) continue;
    const bytes = await Deno.readFile(url);
    if (bytes.subarray(0, 8000).includes(0)) continue; // binary
    scanned++;
    findings.push(...findSecrets(decoder.decode(bytes), file));
  }
  return { scanned, findings };
}

if (import.meta.main) {
  const root = new URL("../", import.meta.url);
  const { scanned, findings } = await scanTrackedFiles(root);
  for (const f of findings) console.error(`SECRET? ${f.file}:${f.line} ${f.preview}`);
  console.log(`secret_scan: ${scanned} files, ${findings.length} findings`);
  if (findings.length > 0) Deno.exit(1);
}
