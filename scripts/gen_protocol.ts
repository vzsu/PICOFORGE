// scripts/gen_protocol.ts — `deno task gen:protocol`: copy the wire contracts from server/domain/ into
// app/src/protocol/ (docs/01 §3: "src/protocol/ ← generated from server/domain"). One source of truth;
// PROTO-GEN-01 fails `deno task check` when a copy is stale. The files must stay self-contained
// (imports only "zod" and each other), which domain/ already guarantees (docs/05 §1).

/** Wire contracts shared with the app. */
export const PROTOCOL_FILES = ["events.ts", "modes.ts", "pts1.ts"] as const;

export function generated(name: string, source: string): string {
  return `// GENERATED from server/domain/${name} by \`deno task gen:protocol\`. Do not edit here.\n` +
    source;
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url);
  await Deno.mkdir(new URL("app/src/protocol/", root), { recursive: true });
  for (const name of PROTOCOL_FILES) {
    const src = await Deno.readTextFile(new URL(`server/domain/${name}`, root));
    await Deno.writeTextFile(new URL(`app/src/protocol/${name}`, root), generated(name, src));
    console.log(`app/src/protocol/${name}`);
  }
}
