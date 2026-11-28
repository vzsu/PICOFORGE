// server/engine/tests/fakeEngine.ts — a stand-in forge-engine for client tests (ndjson over stdio).
// engine.hello and engine.ping answer at once; engine.run and engine.inspect after RUN_DELAY_MS.
const RUN_DELAY_MS = Number(Deno.args[0] ?? "1500");
const enc = new TextEncoder();
const write = (o: unknown) => Deno.stdout.writeSync(enc.encode(JSON.stringify(o) + "\n"));

let buf = "";
for await (const chunk of Deno.stdin.readable) {
  buf += new TextDecoder().decode(chunk);
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg: unknown = JSON.parse(line);
    if (typeof msg !== "object" || msg === null || !("id" in msg) || !("method" in msg)) continue;
    const { id, method } = msg;
    if (method === "engine.hello") {
      write({
        id,
        result: { version: "fake", picogkVersion: "0", dotnet: "0", symbolTableHash: "0" },
      });
    } else if (method === "engine.ping") {
      write({ id, result: { ok: true, rssMiB: 1, children: 0 } });
    } else if (method === "engine.inspect") {
      setTimeout(
        () => write({ id, result: { target: "t", measurements: { volumeCm3: 1 }, results: [] } }),
        RUN_DELAY_MS,
      );
    } else if (method === "engine.run") {
      setTimeout(() => write({ id, result: { ok: true } }), RUN_DELAY_MS);
    } else {
      write({ id, error: { code: "UNKNOWN_METHOD", message: String(method) } });
    }
  }
}
