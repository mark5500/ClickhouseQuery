using QueryBuilder.Visualisations;
using static QueryBuilder.SqlBuilder.SqlText;

namespace QueryBuilder.SqlBuilder;

internal static class CteBuilder
{
    // Projects only the datapoint columns plus the specific payload
    // sub-columns this visualisation references — not `SELECT *` — so
    // ClickHouse only reads the JSON paths actually needed instead of the
    // whole payload structure.
    //
    // "pick" (latest/earliest record per subject) is implemented as
    // `GROUP BY subject_id` + `argMax`/`argMin`, not `ORDER BY ... LIMIT 1
    // BY subject_id`. Both pick the same row per subject, but LIMIT BY forces
    // a full sort of every matching row before it can dedupe, while
    // argMax/argMin is a single hash aggregation — substantially cheaper at
    // scale (measured ~3x faster on this project's data).
    //
    // Deliberately doesn't project `data_extract_id` (constant per CTE,
    // never referenced downstream): mixing a literal constant column into a
    // SELECT alongside multiple aggregates that share a comparator
    // (argMax/max keyed on the same `submitted_at`) under GROUP BY corrupted
    // ~78% of rows in testing on ClickHouse 24.8.14 — silently, with no
    // error. Reproduced deterministically with both String and native-JSON
    // `payload` columns, so it's a GROUP BY/constant-folding issue, not
    // specific to either. If a future field genuinely needs a constant
    // projected here, verify against a real `GROUP BY` (not just a small
    // LIMIT) first.
    public static string BuildCte(ExtractBinding extract, IReadOnlySet<string> neededFields, IReadOnlyDictionary<string, DataExtract> registry)
    {
        if (!registry.TryGetValue(extract.DataExtractKey, out var def))
        {
            throw new InvalidOperationException($"Unknown data extract: '{extract.DataExtractKey}'");
        }

        // Table-qualified: when this field's own output alias has the same
        // name as the source column (e.g. `max(submitted_at) AS submitted_at`),
        // ClickHouse resolves a later *bare* reference to that alias instead
        // of the underlying column — which then trips "aggregate inside
        // aggregate" once that reference is itself wrapped in another
        // aggregate (argMax's second argument). Qualifying with
        // `data_points.` sidesteps it.
        string SourceExpr(string field)
        {
            if (FieldRefCollection.DatapointFields.Contains(field)) return $"data_points.{field}";
            var fieldDef = def.Fields.FirstOrDefault(f => f.Name == field)
                ?? throw new InvalidOperationException($"Unknown field '{field}' on extract '{extract.DataExtractKey}'");
            return $"data_points.payload.{QuoteIdentifier(field)}::{JsonCastType(fieldDef.Type)}";
        }

        // `id`/`submitted_at` are always projected even if no channel
        // references them directly — `submitted_at` in particular is needed
        // internally to pick the latest/earliest record per subject.
        var otherFields = new[] { "id", "submitted_at" }.Concat(neededFields).Distinct().ToList();

        var lines = new List<string> { $"  {QuoteIdentifier(extract.DataExtractKey)} AS (" };

        if (extract.Resolve is PickResolveStrategy pick)
        {
            var byField = pick.By.Field;
            var pickFn = pick.By.Direction == SortDirection.Desc ? "argMax" : "argMin";
            var pickScalarFn = pick.By.Direction == SortDirection.Desc ? "max" : "min";
            var byExpr = SourceExpr(byField);

            var columns = otherFields.Select(field =>
            {
                var expr = SourceExpr(field);
                var agg = field == byField ? $"{pickScalarFn}({expr})" : $"{pickFn}({expr}, {byExpr})";
                return $"{agg} AS {QuoteIdentifier(field)}";
            });

            lines.Add("    SELECT");
            lines.Add("      subject_id,");
            lines.Add($"      {string.Join(",\n      ", columns)}");
            lines.Add("    FROM data_points");
            lines.Add($"    WHERE data_extract_id = {QuoteString(extract.DataExtractKey)}");
            lines.Add("    GROUP BY subject_id");
        }
        else if (extract.Resolve is AllResolveStrategy all)
        {
            var columns = otherFields.Select(field => $"{SourceExpr(field)} AS {QuoteIdentifier(field)}");

            lines.Add("    SELECT");
            lines.Add("      subject_id,");
            lines.Add($"      {string.Join(",\n      ", columns)}");
            lines.Add("    FROM data_points");
            lines.Add($"    WHERE data_extract_id = {QuoteString(extract.DataExtractKey)}");
            lines.Add($"    ORDER BY {all.OrderBy.Field} {all.OrderBy.Direction.ToString().ToUpperInvariant()}");
        }

        lines.Add("  )");
        return string.Join("\n", lines);
    }

    public static string BuildCtes(Visualisation viz, IReadOnlyDictionary<string, DataExtract> registry)
    {
        var fieldsByAlias = FieldRefCollection.PayloadFieldsByAlias(viz);
        return string.Join(",\n", viz.Extracts.Select(extract =>
            BuildCte(extract, fieldsByAlias.GetValueOrDefault(extract.DataExtractKey, []), registry)));
    }
}
