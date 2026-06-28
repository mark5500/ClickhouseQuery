using QueryBuilder.Visualisations;

namespace QueryBuilder.SqlBuilder;

internal static class FieldRefCollection
{
    // Columns that live on the data_points row itself rather than inside `payload`.
    public static readonly HashSet<string> DatapointFields = ["id", "subject_id", "submitted_at", "data_extract_id"];

    private readonly record struct FieldRefLike(string Extract, string Field);

    // Every field a visualisation touches — select channels, filters, table
    // sort — across every type. Used both to validate aliases/fields up
    // front and to work out which payload paths each CTE actually needs.
    private static IEnumerable<FieldRefLike> CollectFieldRefs(Visualisation viz)
    {
        foreach (var filter in viz.Filters)
        {
            yield return new FieldRefLike(filter.Extract, filter.Field);
        }

        switch (viz)
        {
            case TableVisualisation table:
                foreach (var col in table.Columns)
                {
                    yield return new FieldRefLike(col.Extract, col.Field);
                }
                if (table.Sort is { } sort)
                {
                    yield return new FieldRefLike(sort.Extract, sort.Field);
                }
                break;

            case BarVisualisation bar:
            {
                yield return new FieldRefLike(bar.X.Extract, bar.X.Field);
                foreach (var y in bar.Y)
                {
                    yield return new FieldRefLike(y.Extract, y.Field);
                }
                if (bar.Series is { } series)
                {
                    yield return new FieldRefLike(series.Extract, series.Field);
                }
                break;
            }

            case LineVisualisation line:
            {
                yield return new FieldRefLike(line.X.Extract, line.X.Field);
                foreach (var y in line.Y)
                {
                    yield return new FieldRefLike(y.Extract, y.Field);
                }
                if (line.Series is { } series)
                {
                    yield return new FieldRefLike(series.Extract, series.Field);
                }
                break;
            }

            case AreaVisualisation area:
            {
                yield return new FieldRefLike(area.X.Extract, area.X.Field);
                foreach (var y in area.Y)
                {
                    yield return new FieldRefLike(y.Extract, y.Field);
                }
                if (area.Series is { } series)
                {
                    yield return new FieldRefLike(series.Extract, series.Field);
                }
                break;
            }

            case ScatterVisualisation scatter:
            {
                yield return new FieldRefLike(scatter.X.Extract, scatter.X.Field);
                yield return new FieldRefLike(scatter.Y.Extract, scatter.Y.Field);
                if (scatter.Series is { } series)
                {
                    yield return new FieldRefLike(series.Extract, series.Field);
                }
                break;
            }

            case PieVisualisation pie:
                yield return new FieldRefLike(pie.Category.Extract, pie.Category.Field);
                yield return new FieldRefLike(pie.Value.Extract, pie.Value.Field);
                break;

            case DistributionVisualisation distribution:
                yield return new FieldRefLike(distribution.Value.Extract, distribution.Value.Field);
                break;
        }
    }

    // Fails fast — and with the same error messages callers already depend
    // on — before any SQL is built, rather than discovering a bad
    // alias/field via a ClickHouse error at execution time.
    public static void ValidateFieldRefs(Visualisation viz, IReadOnlyDictionary<string, DataExtract> registry)
    {
        var aliases = viz.Extracts.Select(e => e.DataExtractKey).ToHashSet();

        foreach (var (extract, field) in CollectFieldRefs(viz))
        {
            if (DatapointFields.Contains(field)) continue;

            if (!aliases.Contains(extract))
            {
                throw new InvalidOperationException($"Unknown extract alias: '{extract}'");
            }
            if (!registry.TryGetValue(extract, out var def))
            {
                throw new InvalidOperationException($"Unknown data extract: '{extract}'");
            }
            if (!def.Fields.Any(f => f.Name == field))
            {
                throw new InvalidOperationException($"Unknown field '{field}' on extract '{extract}'");
            }
        }
    }

    // Which payload fields each extract alias's CTE needs to project, derived
    // from every reference to that alias across the whole visualisation.
    // Lets each CTE select only the JSON sub-columns it actually needs
    // instead of the whole payload, which is what makes JSON sub-column
    // pruning possible.
    public static Dictionary<string, HashSet<string>> PayloadFieldsByAlias(Visualisation viz)
    {
        var map = new Dictionary<string, HashSet<string>>();
        foreach (var (extract, field) in CollectFieldRefs(viz))
        {
            if (DatapointFields.Contains(field)) continue;
            if (!map.TryGetValue(extract, out var set))
            {
                set = [];
                map[extract] = set;
            }
            set.Add(field);
        }
        return map;
    }
}
