// Narrow analyzer suppressions for ForgeSandbox. Each one is logged as a DECISION in the devlog.

using System.Diagnostics.CodeAnalysis;

// CA1515 asks an exe's public types to be internal. PicoForge.Kit lives in this exe on purpose: it is the
// public API that generated designs compile against (the host references forge-sandbox.dll as metadata)
// and that Kit.Tests exercises. Making it internal would break the code contract (docs/05 §4–5).
[assembly: SuppressMessage("Maintainability", "CA1515:Consider making public types internal",
    Justification = "PicoForge.Kit is the public API generated designs compile against.", Scope = "namespaceanddescendants", Target = "~N:PicoForge.Kit")]
