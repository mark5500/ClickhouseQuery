using System.Text.Json.Serialization;

namespace QueryBuilder.Visualisations;

// The user picks `type` first (the JSON discriminator below), which dictates
// the channels they then fill in on the derived record. Closed hierarchy:
// `private protected` constructor means only the seven cases below can ever
// derive from it, so a `switch` over a `Visualisation` can be exhaustive.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(TableVisualisation), "table")]
[JsonDerivedType(typeof(BarVisualisation), "bar")]
[JsonDerivedType(typeof(LineVisualisation), "line")]
[JsonDerivedType(typeof(AreaVisualisation), "area")]
[JsonDerivedType(typeof(ScatterVisualisation), "scatter")]
[JsonDerivedType(typeof(PieVisualisation), "pie")]
[JsonDerivedType(typeof(DistributionVisualisation), "distribution")]
public abstract record Visualisation
{
    private protected Visualisation() { }

    public required string Id { get; init; }
    public required string Title { get; init; }
    public required IReadOnlyList<ExtractBinding> Extracts { get; init; }
    public required IReadOnlyList<Filter> Filters { get; init; }
    public required Pagination? Pagination { get; init; }
}

public sealed record TableVisualisation : Visualisation
{
    public required IReadOnlyList<FieldRef> Columns { get; init; }
    public required Sort? Sort { get; init; }
}

// X = "what am I grouping by?" e.g. month, region.
// Y = "what am I measuring?" e.g. avg(bmi), sum(revenue), count(*).
// Series = "what am I splitting by inside each group?" e.g. product category

public sealed record BarVisualisation : Visualisation
{
    public required FieldRef X { get; init; }
    public required IReadOnlyList<FieldRef> Y { get; init; }
    public FieldRef? Series { get; init; }
}

public sealed record LineVisualisation : Visualisation
{
    public required FieldRef X { get; init; }
    public required IReadOnlyList<FieldRef> Y { get; init; }
    public FieldRef? Series { get; init; }
}

public sealed record AreaVisualisation : Visualisation
{
    public required FieldRef X { get; init; }
    public required IReadOnlyList<FieldRef> Y { get; init; }
    public FieldRef? Series { get; init; }
}

public sealed record ScatterVisualisation : Visualisation
{
    public required FieldRef X { get; init; }
    public required FieldRef Y { get; init; }
    public FieldRef? Series { get; init; }

    // A scatter chart returns one row per matched point — with large
    // datasets that's too many to render. `SampleSize`, if set, takes a
    // random sample of this many points instead of every match.
    public int? SampleSize { get; init; }
}

public sealed record PieVisualisation : Visualisation
{
    public required FieldRef Category { get; init; }
    public required FieldRef Value { get; init; }
}

public sealed record DistributionVisualisation : Visualisation
{
    public required FieldRef Value { get; init; }
    public BinningStrategy? Binning { get; init; }
}
