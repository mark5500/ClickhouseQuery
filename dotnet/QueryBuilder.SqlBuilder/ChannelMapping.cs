using QueryBuilder.Visualisations;
using static QueryBuilder.SqlBuilder.SqlText;

namespace QueryBuilder.SqlBuilder;

internal sealed record OrderByChannel(string Extract, string Field, SortDirection Direction);

// Maps the channels of a typed visualisation onto a flat, ordered SELECT list
// plus an optional ORDER BY. Grouping is derived generically downstream: any
// non-aggregated select column becomes a GROUP BY key when an aggregate exists.
internal sealed record Channels(IReadOnlyList<FieldRef> Select, OrderByChannel? OrderBy);

internal static class ChannelMapping
{
    // Chart types alias their single-valued channels to these fixed names,
    // regardless of any `label` the caller set, so a client never needs
    // field-level metadata to render those — just the visualisation's `type`
    // and the canonical keys below. This doesn't extend to `Y` on
    // bar/line/area: with more than one measure there's no single fixed
    // name to give them all, so those keep their own `Label`/ColumnAlias.
    private static FieldRef WithCanonicalLabel(FieldRef field, string label) => field with { Label = label };

    public static Channels ChannelsFor(Visualisation viz) => viz switch
    {
        TableVisualisation table => new Channels(
            table.Columns,
            table.Sort is { } sort ? new OrderByChannel(sort.Extract, sort.Field, sort.Direction) : null),

        BarVisualisation bar => new Channels(BuildAxisSelect(bar.X, bar.Y, bar.Series), null),

        LineVisualisation line => new Channels(
            BuildAxisSelect(line.X, line.Y, line.Series),
            new OrderByChannel(line.X.Extract, line.X.Field, SortDirection.Asc)),

        AreaVisualisation area => new Channels(
            BuildAxisSelect(area.X, area.Y, area.Series),
            new OrderByChannel(area.X.Extract, area.X.Field, SortDirection.Asc)),

        // A scatter chart isn't inherently ordered along its x axis the way
        // line/area are, so it gets no implicit ORDER BY.
        ScatterVisualisation scatter => new Channels(
            scatter.Series is { } series
                ? [WithCanonicalLabel(series, "series"), WithCanonicalLabel(scatter.X, "x"), WithCanonicalLabel(scatter.Y, "y")]
                : [WithCanonicalLabel(scatter.X, "x"), WithCanonicalLabel(scatter.Y, "y")],
            null),

        PieVisualisation pie => new Channels(
            [WithCanonicalLabel(pie.Category, "category"), WithCanonicalLabel(pie.Value, "value")],
            null),

        // Distribution has its own query shape (see DistributionSqlBuilder)
        // since it computes a server-side histogram rather than selecting
        // raw rows.
        DistributionVisualisation => new Channels([], null),

        _ => throw new ArgumentOutOfRangeException(nameof(viz)),
    };

    private static IReadOnlyList<FieldRef> BuildAxisSelect(FieldRef x, IReadOnlyList<FieldRef> y, FieldRef? series)
    {
        var select = new List<FieldRef> { WithCanonicalLabel(x, "x") };
        if (series is { } s)
        {
            select.Insert(0, WithCanonicalLabel(s, "series"));
        }
        select.AddRange(y);
        return select;
    }

    // The alias a column resolves to in the result set — `Label` if set,
    // else `{extract}_{field}`. Public so callers (e.g. a dashboard
    // endpoint) can tell clients which key to read for a given table column
    // without duplicating this convention.
    public static string ColumnAlias(FieldRef col) => col.Label ?? $"{col.Extract}_{col.Field}";

    public static string BuildColumn(FieldRef col)
    {
        var expr = Resolve(col.Extract, col.Field, col.Bucket);
        if (col.Aggregate is { } aggregate)
        {
            expr = $"{aggregate.ToString().ToLowerInvariant()}({expr})";
            // count()/sum() return UInt64, which ClickHouse's JSON formats
            // serialize as a string to avoid precision loss — cast so
            // clients get a plain number.
            if (aggregate is Aggregation.Count or Aggregation.Sum)
            {
                expr = $"toFloat64({expr})";
            }
        }
        return $"{expr} AS {QuoteIdentifier(ColumnAlias(col))}";
    }
}
