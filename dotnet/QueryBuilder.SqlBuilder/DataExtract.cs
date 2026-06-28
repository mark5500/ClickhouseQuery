namespace QueryBuilder.SqlBuilder;

public enum FieldType
{
    String,
    Number,
    Boolean,
    Date,
}

public sealed record DataExtractField
{
    public required string Name { get; init; }
    public required FieldType Type { get; init; }
}

// The registered shape of one source of data points — what an ExtractBinding
// (in QueryBuilder.Visualisations) refers to by `DataExtractKey`. Holds the
// field/type schema the SQL builder needs to cast each JSON payload path to
// the right ClickHouse type.
public sealed record DataExtract
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required IReadOnlyList<DataExtractField> Fields { get; init; }
}
