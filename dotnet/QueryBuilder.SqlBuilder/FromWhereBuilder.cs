using QueryBuilder.Visualisations;
using static QueryBuilder.SqlBuilder.SqlText;

namespace QueryBuilder.SqlBuilder;

internal static class FromWhereBuilder
{
    // FROM <driving> INNER JOIN <rest> ON subject_id, plus an optional WHERE
    // — shared by the main query, the distribution histogram subquery, and
    // the table row-count query.
    public static (string FromClause, string? WhereClause) Build(Visualisation viz)
    {
        var driving = viz.Extracts[0];
        var fromLines = new List<string> { $"FROM {QuoteIdentifier(driving.DataExtractKey)}" };

        foreach (var extract in viz.Extracts.Skip(1))
        {
            fromLines.Add(
                $"INNER JOIN {QuoteIdentifier(extract.DataExtractKey)} ON " +
                $"{QuoteIdentifier(driving.DataExtractKey)}.subject_id = {QuoteIdentifier(extract.DataExtractKey)}.subject_id");
        }

        var whereClause = viz.Filters.Count > 0
            ? $"WHERE {string.Join(" AND ", viz.Filters.Select(FilterBuilder.BuildFilter))}"
            : null;

        return (string.Join("\n", fromLines), whereClause);
    }
}
