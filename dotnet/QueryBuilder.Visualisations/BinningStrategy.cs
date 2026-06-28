using System.Text.Json.Serialization;

namespace QueryBuilder.Visualisations;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "strategy")]
[JsonDerivedType(typeof(AutoBinningStrategy), "auto")]
[JsonDerivedType(typeof(FixedWidthBinningStrategy), "fixed-width")]
[JsonDerivedType(typeof(CustomBinningStrategy), "custom")]
public abstract record BinningStrategy
{
    private protected BinningStrategy() { }
}

// The engine's own adaptive histogram — picks its own (unequal-width) bins.
public sealed record AutoBinningStrategy : BinningStrategy
{
    public int? Bins { get; init; }
}

// Equal-width bins over an explicit range.
public sealed record FixedWidthBinningStrategy : BinningStrategy
{
    public required double BinWidth { get; init; }
    public required double Min { get; init; }
    public required double Max { get; init; }
}

// Named bands with explicit boundaries, e.g. WHO BMI categories.
public sealed record CustomBinningStrategy : BinningStrategy
{
    public required IReadOnlyList<HistogramBucket> Buckets { get; init; }
}
