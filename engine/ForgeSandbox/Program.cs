// ForgeSandbox/Program.cs — Sandbox child entry point
// Receives the job path via `--job <path>` or the first stdin line (prewarmed spare), runs Runner, exits.
// docs/04 §2: one child per job, killed on any fault.

using ForgeSandbox;

string? jobPath = null;
for (int i = 0; i < args.Length - 1; i++)
    if (args[i] == "--job") { jobPath = args[i + 1]; break; }

jobPath ??= Console.ReadLine()?.Trim();

if (string.IsNullOrEmpty(jobPath))
{
    Console.Error.WriteLine("{\"error\":\"NO_JOB\",\"message\":\"No job path provided via --job or stdin\"}");
    return 1;
}

if (!File.Exists(jobPath))
{
    Console.Error.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { error = "JOB_NOT_FOUND", message = $"Job file not found: {jobPath}" }));
    return 1;
}

return Runner.Run(jobPath);
