using System.Text.Json;
using System.Text.Json.Serialization;

namespace QueryBuilder.Visualisations;

// `[JsonConverter(typeof(JsonStringEnumConverter<T>))]` alone serializes
// members verbatim (PascalCase) — it can't carry a naming policy, since
// attribute arguments must be compile-time constants. This subclass bakes
// camelCase in as the default, while still respecting per-member
// `[JsonStringEnumMemberName]` overrides (see FilterOperator below).
internal sealed class CamelCaseEnumConverter<TEnum> : JsonStringEnumConverter<TEnum>
    where TEnum : struct, Enum
{
    public CamelCaseEnumConverter() : base(JsonNamingPolicy.CamelCase) { }
}

[JsonConverter(typeof(CamelCaseEnumConverter<SortDirection>))]
public enum SortDirection
{
    Asc,
    Desc,
}

[JsonConverter(typeof(CamelCaseEnumConverter<Aggregation>))]
public enum Aggregation
{
    Count,
    Avg,
    Sum,
    Min,
    Max,
}

[JsonConverter(typeof(CamelCaseEnumConverter<DateBucket>))]
public enum DateBucket
{
    Day,
    Week,
    Month,
}

[JsonConverter(typeof(CamelCaseEnumConverter<FilterOperator>))]
public enum FilterOperator
{
    [JsonStringEnumMemberName("=")] Equal,
    [JsonStringEnumMemberName("!=")] NotEqual,
    [JsonStringEnumMemberName("<")] LessThan,
    [JsonStringEnumMemberName("<=")] LessThanOrEqual,
    [JsonStringEnumMemberName(">")] GreaterThan,
    [JsonStringEnumMemberName(">=")] GreaterThanOrEqual,
    [JsonStringEnumMemberName("in")] In,
    [JsonStringEnumMemberName("contains")] Contains,
}

public sealed record OrderBy
{
    public required string Field { get; init; }
    public required SortDirection Direction { get; init; }
}

// A reference to a field by extract alias. `Field` may be a payload field
// ("bmi", "sex") or a datapoint field ("subject_id"). `Bucket`
// truncates a date/datetime field to a coarser granularity — typically used
// on a time axis so it can be grouped/aggregated over (e.g. avg per month).
public sealed record FieldRef
{
    public required string Extract { get; init; }
    public required string Field { get; init; }
    public Aggregation? Aggregate { get; init; }
    public DateBucket? Bucket { get; init; }
    public string? Label { get; init; }
}

// `Value` mirrors a JSON union of string | number | boolean | array of
// (string | number) — there's no native union type in C#, so callers read it
// out of the JsonElement themselves based on `Op`.
public sealed record Filter
{
    public required string Extract { get; init; }
    public required string Field { get; init; }
    public required FilterOperator Op { get; init; }
    public required System.Text.Json.JsonElement Value { get; init; }
}

public sealed record Sort
{
    public required string Extract { get; init; }
    public required string Field { get; init; }
    public required SortDirection Direction { get; init; }
}

public sealed record Pagination
{
    public required int Limit { get; init; }
    public required int Offset { get; init; }
}

// A named band with an upper bound — e.g. WHO BMI categories. The bucket
// catches values < Max; the last bucket in the list should leave `Max` null
// so it catches everything above the previous one.
public sealed record HistogramBucket
{
    public required string Label { get; init; }
    public double? Max { get; init; }
}
