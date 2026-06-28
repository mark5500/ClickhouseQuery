using System.Text.Json;
using QueryBuilder.Visualisations;
using static QueryBuilder.SqlBuilder.SqlText;

namespace QueryBuilder.SqlBuilder;

internal static class FilterBuilder
{
    public static string BuildFilter(Filter filter)
    {
        var expr = Resolve(filter.Extract, filter.Field, bucket: null);

        switch (filter.Op)
        {
            case FilterOperator.In:
                if (filter.Value.ValueKind != JsonValueKind.Array)
                {
                    throw new InvalidOperationException($"Filter 'in' on '{filter.Field}' requires an array value");
                }
                return $"{expr} IN ({string.Join(", ", filter.Value.EnumerateArray().Select(Literal))})";

            case FilterOperator.Contains:
                var text = filter.Value.ValueKind == JsonValueKind.String
                    ? filter.Value.GetString()!
                    : filter.Value.GetRawText();
                return $"{expr} LIKE {QuoteString($"%{text}%")}";

            default:
                if (filter.Value.ValueKind == JsonValueKind.Array)
                {
                    throw new InvalidOperationException($"Filter '{filter.Op}' on '{filter.Field}' requires a scalar value");
                }
                return $"{expr} {OperatorSymbol(filter.Op)} {Literal(filter.Value)}";
        }
    }
}
