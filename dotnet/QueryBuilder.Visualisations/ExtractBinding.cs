namespace QueryBuilder.Visualisations;

// One named source of data for a visualisation — `Key` identifies the
// DataExtract this binding pulls from, and is what other parts of the
// visualisation use to refer back to it (e.g. via FieldRef.Extract).
public sealed record ExtractBinding
{
    public required string DataExtractKey { get; init; }
    public required ResolveStrategy Resolve { get; init; }
}
