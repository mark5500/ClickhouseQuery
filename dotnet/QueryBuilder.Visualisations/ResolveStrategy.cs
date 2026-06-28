using System.Text.Json.Serialization;

namespace QueryBuilder.Visualisations;

// How to resolve multiple submissions per subject down to the grain a
// visualization needs. Closed hierarchy: `private protected` constructor
// means only the two cases below can ever derive from it.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "strategy")]
[JsonDerivedType(typeof(AllResolveStrategy), "all")]
[JsonDerivedType(typeof(PickResolveStrategy), "pick")]
public abstract record ResolveStrategy
{
    private protected ResolveStrategy() { }
}

// Keep every submission, ordered — used when a visualisation needs more than
// one record per subject (e.g. a trend line over time).
public sealed record AllResolveStrategy : ResolveStrategy
{
    public required OrderBy OrderBy { get; init; }
}

// Collapse to a single submission per subject — the one ranked first by `By`.
public sealed record PickResolveStrategy : ResolveStrategy
{
    public required OrderBy By { get; init; }
}
