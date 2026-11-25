// DumpApi/Program.cs — Reflection walker: PicoGK.dll (+ forge-sandbox.dll Kit) → picogk_api.json
// This is the critical link that makes "what the model is told exists" = "what actually compiles".
// SYS_DESIGN §4.1, PICOGK_KNOWLEDGE §1
//
// Usage: dump-api <out.json> [path/to/forge-sandbox.dll]
// Reflection only: no PicoGK native call is made, so no native runtime or viewer is needed.

using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

var outPath = args.Length > 0 ? args[0] : "picogk_api.json";
var kitPath = args.Length > 1 ? args[1] : null;

var assemblies = new List<Assembly> { typeof(PicoGK.Voxels).Assembly };
if (kitPath is not null)
{
    if (!File.Exists(kitPath))
    {
        Console.Error.WriteLine($"DumpApi: Kit assembly not found: {kitPath}");
        return 1;
    }
    assemblies.Add(Assembly.LoadFrom(Path.GetFullPath(kitPath)));
}

var targetNamespaces = new HashSet<string>(StringComparer.Ordinal) { "PicoGK", "PicoForge.Kit" };
var types = new List<ApiType>();

foreach (var asm in assemblies)
{
    foreach (var type in asm.GetExportedTypes().OrderBy(t => t.FullName, StringComparer.Ordinal))
    {
        if (!targetNamespaces.Contains(type.Namespace ?? "")) continue;

        var members = new List<ApiMember>();
        const BindingFlags flags = BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly;

        foreach (var ctor in type.GetConstructors(BindingFlags.Public | BindingFlags.Instance))
            members.Add(new ApiMember { Name = ".ctor", Kind = "ctor", Sig = $"{type.Name}({ParamList(ctor)})" });

        foreach (var method in type.GetMethods(flags).Where(m => !m.IsSpecialName).OrderBy(m => m.Name, StringComparer.Ordinal))
        {
            var kind = method.Name.StartsWith("op_", StringComparison.Ordinal) ? "operator" : "method";
            members.Add(new ApiMember { Name = method.Name, Kind = kind, Sig = BuildMethodSig(method) });
        }
        foreach (var method in type.GetMethods(flags).Where(m => m.IsSpecialName && m.Name.StartsWith("op_", StringComparison.Ordinal)))
            members.Add(new ApiMember { Name = method.Name, Kind = "operator", Sig = BuildMethodSig(method) });

        foreach (var prop in type.GetProperties(flags).OrderBy(p => p.Name, StringComparer.Ordinal))
        {
            var acc = (prop.GetMethod?.IsPublic == true ? "get; " : "") + (prop.SetMethod?.IsPublic == true ? "set; " : "");
            var stat = (prop.GetMethod?.IsStatic ?? prop.SetMethod?.IsStatic ?? false) ? "static " : "";
            members.Add(new ApiMember { Name = prop.Name, Kind = "property", Sig = $"{stat}{TypeName(prop.PropertyType)} {prop.Name} {{ {acc}}}" });
        }

        foreach (var field in type.GetFields(flags).Where(f => !f.IsSpecialName).OrderBy(f => f.Name, StringComparer.Ordinal))
        {
            var mod = field.IsLiteral ? "const " : field.IsStatic ? "static " : "";
            members.Add(new ApiMember { Name = field.Name, Kind = "field", Sig = $"{mod}{TypeName(field.FieldType)} {field.Name}" });
        }

        foreach (var ev in type.GetEvents(flags))
            members.Add(new ApiMember { Name = ev.Name, Kind = "event", Sig = $"event {TypeName(ev.EventHandlerType!)} {ev.Name}" });

        types.Add(new ApiType
        {
            Name = TypeName(type),
            FullName = type.FullName ?? type.Name,
            Namespace = type.Namespace ?? "",
            Kind = type.IsInterface ? "interface" : type.IsEnum ? "enum" : type.IsValueType ? "struct"
                 : type.IsAbstract && type.IsSealed ? "static class" : typeof(Delegate).IsAssignableFrom(type) ? "delegate" : "class",
            BaseType = type.BaseType is { } b && b != typeof(object) && b != typeof(ValueType) && b != typeof(Enum) ? TypeName(b) : null,
            Interfaces = type.GetInterfaces().Where(i => (i.Namespace ?? "").StartsWith("PicoGK", StringComparison.Ordinal)
                                                        || i == typeof(IDisposable)).Select(TypeName).OrderBy(x => x, StringComparer.Ordinal).ToArray(),
            EnumValues = type.IsEnum ? Enum.GetNames(type) : null,
            Members = members.ToArray(),
        });
    }
}

// Banned namespaces for the Roslyn analyzer (docs/04 §8)
var bannedNamespaces = new[]
{
    "System.IO", "System.Net", "System.Reflection.Emit", "System.Diagnostics", "System.Threading",
    "System.Runtime.InteropServices", "System.Environment", "System.AppDomain",
};

var picogk = typeof(PicoGK.Voxels).Assembly;
var picogkVersion = picogk.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                    ?? picogk.GetName().Version?.ToString() ?? "unknown";

var manifest = new ApiManifest
{
    Version = "1.0.0-p0",
    PicoGKVersion = picogkVersion.Split('+')[0],
    PicoGKAssemblyVersion = picogk.GetName().Version?.ToString() ?? "unknown",
    Types = types.ToArray(),
    BannedNamespaces = bannedNamespaces,
};

var jsonOptions = new JsonSerializerOptions
{
    WriteIndented = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
};
// Deterministic output (no timestamp) so the symbol-table hash only changes when the API changes.
var json = JsonSerializer.Serialize(manifest, jsonOptions).Replace("\r\n", "\n", StringComparison.Ordinal) + "\n";
await File.WriteAllTextAsync(outPath, json, new UTF8Encoding(false));

Console.WriteLine($"DumpApi: wrote {types.Count} types, {types.Sum(t => t.Members.Length)} members -> {outPath}");
Console.WriteLine($"DumpApi: PicoGK version = {manifest.PicoGKVersion}");
return 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

static string BuildMethodSig(MethodInfo m)
{
    var sb = new StringBuilder();
    if (m.IsStatic) sb.Append("static ");
    sb.Append(TypeName(m.ReturnType)).Append(' ').Append(m.Name);
    if (m.IsGenericMethodDefinition)
        sb.Append('<').Append(string.Join(",", m.GetGenericArguments().Select(a => a.Name))).Append('>');
    sb.Append('(').Append(ParamList(m)).Append(')');
    return sb.ToString();
}

static string ParamList(MethodBase m) => string.Join(", ", m.GetParameters().Select(p =>
{
    var t = p.ParameterType;
    string mod = "";
    if (t.IsByRef)
    {
        t = t.GetElementType()!;
        mod = p.IsOut ? "out " : p.IsIn ? "in " : "ref ";
    }
    if (p.GetCustomAttribute<ParamArrayAttribute>() is not null) mod = "params ";
    var s = $"{mod}{TypeName(t)} {p.Name}";
    if (p.HasDefaultValue) s += " = " + FormatDefault(p.DefaultValue);
    return s;
}));

static string FormatDefault(object? v) => v switch
{
    null => "null",
    bool b => b ? "true" : "false",
    string s => $"\"{s}\"",
    Enum e => $"{TypeName(e.GetType())}.{e}",
    float f => f.ToString("R", System.Globalization.CultureInfo.InvariantCulture) + "f",
    double d => d.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
    _ => Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) ?? "?",
};

static string TypeName(Type t)
{
    if (t.IsByRef) return TypeName(t.GetElementType()!);
    if (t.IsArray) return TypeName(t.GetElementType()!) + "[]";
    if (Nullable.GetUnderlyingType(t) is { } u) return TypeName(u) + "?";
    if (t == typeof(void)) return "void";
    if (t == typeof(bool)) return "bool";
    if (t == typeof(int)) return "int";
    if (t == typeof(uint)) return "uint";
    if (t == typeof(long)) return "long";
    if (t == typeof(ulong)) return "ulong";
    if (t == typeof(byte)) return "byte";
    if (t == typeof(float)) return "float";
    if (t == typeof(double)) return "double";
    if (t == typeof(string)) return "string";
    if (t == typeof(object)) return "object";
    var name = t.IsNested ? TypeName(t.DeclaringType!) + "." + t.Name : t.Name;
    if (t.IsGenericType)
        return name.Split('`')[0] + "<" + string.Join(",", t.GetGenericArguments().Select(TypeName)) + ">";
    return name;
}

// ─── Record types ──────────────────────────────────────────────────────────

public record ApiManifest
{
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("picogkVersion")] public required string PicoGKVersion { get; init; }
    [JsonPropertyName("picogkAssemblyVersion")] public required string PicoGKAssemblyVersion { get; init; }
    [JsonPropertyName("types")] public required ApiType[] Types { get; init; }
    [JsonPropertyName("bannedNamespaces")] public required string[] BannedNamespaces { get; init; }
}

public record ApiType
{
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("fullName")] public required string FullName { get; init; }
    [JsonPropertyName("namespace")] public required string Namespace { get; init; }
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("baseType")] public string? BaseType { get; init; }
    [JsonPropertyName("interfaces")] public string[]? Interfaces { get; init; }
    [JsonPropertyName("enumValues")] public string[]? EnumValues { get; init; }
    [JsonPropertyName("members")] public required ApiMember[] Members { get; init; }
}

public record ApiMember
{
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("sig")] public required string Sig { get; init; }
}
