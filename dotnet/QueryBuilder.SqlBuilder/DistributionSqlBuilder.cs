using QueryBuilder.Visualisations;
using static QueryBuilder.SqlBuilder.SqlText;

namespace QueryBuilder.SqlBuilder;

internal static class DistributionSqlBuilder
{
    private static string BuildAutoHistogramSql(int bins, string ctes, string fromClause, string? whereClause, string valueExpr)
    {
        var innerLines = new List<string>
        {
            $"    SELECT arrayJoin(histogram({bins})({valueExpr})) AS bin",
            $"    {fromClause}",
        };
        if (whereClause is { } w) innerLines.Add($"    {w}");

        return string.Join("\n", [
            $"WITH\n{ctes}",
            "SELECT",
            "  round(tupleElement(bin, 1), 2) AS `rangeStart`,",
            "  round(tupleElement(bin, 2), 2) AS `rangeEnd`,",
            "  tupleElement(bin, 3) AS `count`",
            "FROM (",
            string.Join("\n", innerLines),
            ")",
            "ORDER BY `rangeStart`",
        ]);
    }

    private static string BuildFixedWidthHistogramSql(
        double binWidth, double min, double max, string ctes, string fromClause, string? whereClause, string valueExpr)
    {
        var binCount = (int)Math.Ceiling((max - min) / binWidth);
        // Clamp out-of-range values into the first/last bucket rather than dropping them.
        var bucketIndexExpr =
            $"least(greatest(floor(({valueExpr} - {Number(min)}) / {Number(binWidth)}), 0), {binCount - 1})";

        var innerLines = new List<string>
        {
            $"    SELECT {bucketIndexExpr} AS bucketIndex",
            $"    {fromClause}",
        };
        if (whereClause is { } w) innerLines.Add($"    {w}");

        return string.Join("\n", [
            $"WITH\n{ctes}",
            "SELECT",
            $"  round({Number(min)} + bucketIndex * {Number(binWidth)}, 2) AS `rangeStart`,",
            $"  round({Number(min)} + (bucketIndex + 1) * {Number(binWidth)}, 2) AS `rangeEnd`,",
            "  toFloat64(count()) AS `count`",
            "FROM (",
            string.Join("\n", innerLines),
            ")",
            "GROUP BY bucketIndex",
            "ORDER BY bucketIndex",
        ]);
    }

    // Named bands (e.g. WHO BMI categories) via a `multiIf` chain — each
    // bucket tests `value < max`, in order, first match wins. A second
    // `multiIf` over the same boundaries produces a hidden sort key so
    // results come back in the buckets' declared order rather than
    // alphabetically by label.
    private static string BuildCustomBucketsSql(
        IReadOnlyList<HistogramBucket> buckets, string ctes, string fromClause, string? whereClause, string valueExpr)
    {
        string Conditions(Func<HistogramBucket, int, string> mapValue)
        {
            var args = new List<string>();
            for (var i = 0; i < buckets.Count - 1; i++)
            {
                var max = buckets[i].Max
                    ?? throw new InvalidOperationException(
                        $"Bucket '{buckets[i].Label}' must have a 'Max' — only the last bucket may omit it.");
                args.Add($"{valueExpr} < {Number(max)}");
                args.Add(mapValue(buckets[i], i));
            }
            args.Add(mapValue(buckets[^1], buckets.Count - 1));
            return $"multiIf({string.Join(", ", args)})";
        }

        var categoryExpr = Conditions((bucket, _) => QuoteString(bucket.Label));
        // Not selected — only used to GROUP/ORDER BY so buckets come back in
        // their declared order rather than alphabetically by label.
        var orderExpr = Conditions((_, i) => i.ToString());

        var parts = new List<string>
        {
            $"WITH\n{ctes}",
            "SELECT",
            $"  {categoryExpr} AS `category`,",
            "  toFloat64(count()) AS `count`",
            fromClause,
        };
        if (whereClause is { } w) parts.Add(w);
        parts.Add($"GROUP BY `category`, {orderExpr}");
        parts.Add($"ORDER BY {orderExpr}");
        return string.Join("\n", parts);
    }

    // Distribution computes a server-side histogram instead of returning one
    // row per underlying value. The `Binning` strategy picks how:
    // ClickHouse's adaptive histogram(), equal-width bins over an explicit
    // range, or named bands with explicit boundaries.
    public static string BuildDistributionSql(
        DistributionVisualisation viz, string ctes, string fromClause, string? whereClause)
    {
        var valueExpr = Resolve(viz.Value.Extract, viz.Value.Field, viz.Value.Bucket);
        var binning = viz.Binning ?? new AutoBinningStrategy();

        return binning switch
        {
            AutoBinningStrategy auto => BuildAutoHistogramSql(auto.Bins ?? 8, ctes, fromClause, whereClause, valueExpr),
            FixedWidthBinningStrategy fixedWidth => BuildFixedWidthHistogramSql(
                fixedWidth.BinWidth, fixedWidth.Min, fixedWidth.Max, ctes, fromClause, whereClause, valueExpr),
            CustomBinningStrategy custom => BuildCustomBucketsSql(custom.Buckets, ctes, fromClause, whereClause, valueExpr),
            _ => throw new ArgumentOutOfRangeException(nameof(viz)),
        };
    }
}
