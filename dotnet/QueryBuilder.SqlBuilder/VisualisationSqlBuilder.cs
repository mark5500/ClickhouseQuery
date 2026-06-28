using QueryBuilder.Visualisations;
using static QueryBuilder.SqlBuilder.ChannelMapping;

namespace QueryBuilder.SqlBuilder;

public static class VisualisationSqlBuilder
{
    public static string BuildSql(Visualisation viz, IReadOnlyDictionary<string, DataExtract> registry)
    {
        FieldRefCollection.ValidateFieldRefs(viz, registry);
        var ctes = CteBuilder.BuildCtes(viz, registry);
        var (fromClause, whereClause) = FromWhereBuilder.Build(viz);

        if (viz is DistributionVisualisation distribution)
        {
            return DistributionSqlBuilder.BuildDistributionSql(distribution, ctes, fromClause, whereClause);
        }

        var (select, orderBy) = ChannelsFor(viz);

        var selectList = string.Join(",\n", select.Select(col => $"  {BuildColumn(col)}"));
        var parts = new List<string> { $"WITH\n{ctes}", $"SELECT\n{selectList}", fromClause };

        if (whereClause is { } w) parts.Add(w);

        // GROUP BY <non-aggregated columns> (only when aggregating)
        var hasAggregate = select.Any(col => col.Aggregate is not null);
        if (hasAggregate)
        {
            var groupExprs = select
                .Where(col => col.Aggregate is null)
                .Select(col => SqlText.Resolve(col.Extract, col.Field, col.Bucket))
                .ToList();
            if (groupExprs.Count > 0)
            {
                parts.Add($"GROUP BY {string.Join(", ", groupExprs)}");
            }
        }

        // A scatter's `SampleSize` takes priority over any explicit
        // order/pagination — it's a random sample, not a stable page of results.
        if (viz is ScatterVisualisation { SampleSize: { } sampleSize })
        {
            parts.Add("ORDER BY rand()");
            parts.Add($"LIMIT {sampleSize}");
            return string.Join("\n", parts);
        }

        // ORDER BY <channel-derived or explicit sort>
        if (orderBy is { } o)
        {
            parts.Add($"ORDER BY {SqlText.Resolve(o.Extract, o.Field, bucket: null)} {o.Direction.ToString().ToUpperInvariant()}");
        }

        // LIMIT / OFFSET
        if (viz.Pagination is { } pagination)
        {
            parts.Add($"LIMIT {pagination.Limit} OFFSET {pagination.Offset}");
        }

        return string.Join("\n", parts);
    }

    // Total row count for a visualisation's FROM/JOIN/WHERE pipeline,
    // ignoring SELECT/GROUP BY/LIMIT. Used to paginate table results.
    public static string BuildCountSql(Visualisation viz, IReadOnlyDictionary<string, DataExtract> registry)
    {
        FieldRefCollection.ValidateFieldRefs(viz, registry);
        var ctes = CteBuilder.BuildCtes(viz, registry);
        var (fromClause, whereClause) = FromWhereBuilder.Build(viz);

        var parts = new List<string> { $"WITH\n{ctes}", "SELECT toFloat64(count()) AS `total`", fromClause };
        if (whereClause is { } w) parts.Add(w);
        return string.Join("\n", parts);
    }
}
