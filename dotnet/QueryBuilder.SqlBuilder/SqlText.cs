using System.Globalization;
using System.Text.Json;
using QueryBuilder.Visualisations;

namespace QueryBuilder.SqlBuilder;

internal static class SqlText
{
    public static string QuoteString(string value) => $"'{value.Replace("'", "''")}'";

    public static string QuoteIdentifier(string name) => $"`{name.Replace("`", "``")}`";

    public static string Literal(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => QuoteString(value.GetString()!),
        JsonValueKind.True => "1",
        JsonValueKind.False => "0",
        JsonValueKind.Number => value.GetRawText(),
        _ => throw new InvalidOperationException($"Unsupported filter value kind: {value.ValueKind}"),
    };

    public static string Number(double value) => value.ToString(CultureInfo.InvariantCulture);

    // `payload` is a native ClickHouse JSON column, so a path is read as a
    // typed sub-column (e.g. `bmi`.payload.`bmi`::Float64) rather than parsed
    // out of a String at query time — this is the cast type per field type.
    public static string JsonCastType(FieldType type) => type switch
    {
        FieldType.Number => "Float64",
        FieldType.Boolean => "Bool",
        FieldType.String or FieldType.Date => "String",
        _ => throw new ArgumentOutOfRangeException(nameof(type)),
    };

    public static string BucketFn(DateBucket bucket) => bucket switch
    {
        DateBucket.Day => "toDate",
        DateBucket.Week => "toStartOfWeek",
        DateBucket.Month => "toStartOfMonth",
        _ => throw new ArgumentOutOfRangeException(nameof(bucket)),
    };

    // Default-branch comparison operators only — `in`/`contains` are handled
    // separately in FilterBuilder since they don't map to a plain infix op.
    public static string OperatorSymbol(FilterOperator op) => op switch
    {
        FilterOperator.Equal => "=",
        FilterOperator.NotEqual => "!=",
        FilterOperator.LessThan => "<",
        FilterOperator.LessThanOrEqual => "<=",
        FilterOperator.GreaterThan => ">",
        FilterOperator.GreaterThanOrEqual => ">=",
        _ => throw new InvalidOperationException($"Operator '{op}' is not a scalar comparison operator"),
    };

    // Resolves a (extract, field) reference to a SQL expression. Every field
    // — datapoint or payload — is already a plain, typed column on the CTE by
    // this point (see CteBuilder), so resolution is just `extract`.`field`.
    // Both sides are quoted: unlike the TypeScript prototype, an ExtractBinding
    // here has no separate app-chosen alias — `DataExtractKey` (the same
    // string used as the `data_extract_id` filter value) doubles as the CTE
    // name, and it isn't guaranteed to be a bare-identifier-safe string
    // (e.g. "blood-pressure").
    public static string Resolve(string extract, string field, DateBucket? bucket)
    {
        var expr = $"{QuoteIdentifier(extract)}.{QuoteIdentifier(field)}";
        return bucket is { } b ? $"{BucketFn(b)}({expr})" : expr;
    }
}
