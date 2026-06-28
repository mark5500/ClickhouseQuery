using System.Text.Json;
using QueryBuilder.SqlBuilder;
using QueryBuilder.Visualisations;
using Xunit;

namespace QueryBuilder.SqlBuilder.Tests;

public class VisualisationSqlBuilderTests
{
    private static readonly IReadOnlyDictionary<string, DataExtract> Registry = new Dictionary<string, DataExtract>
    {
        ["bmi"] = new DataExtract
        {
            Key = "bmi",
            Title = "BMI Data Extract",
            CreatedAt = DateTimeOffset.UnixEpoch,
            Fields = [
                new DataExtractField { Name = "height", Type = FieldType.Number },
                new DataExtractField { Name = "weight", Type = FieldType.Number },
                new DataExtractField { Name = "bmi", Type = FieldType.Number },
            ],
        },
        ["demographics"] = new DataExtract
        {
            Key = "demographics",
            Title = "Demographics Data Extract",
            CreatedAt = DateTimeOffset.UnixEpoch,
            Fields = [
                new DataExtractField { Name = "givenNames", Type = FieldType.String },
                new DataExtractField { Name = "familyName", Type = FieldType.String },
                new DataExtractField { Name = "sex", Type = FieldType.String },
                new DataExtractField { Name = "dateOfBirth", Type = FieldType.Date },
            ],
        },
    };

    private static readonly ResolveStrategy Latest =
        new PickResolveStrategy { By = new OrderBy { Field = "submitted_at", Direction = SortDirection.Desc } };

    private static ExtractBinding BmiLatest => new() { DataExtractKey = "bmi", Resolve = Latest };
    private static ExtractBinding DemoLatest => new() { DataExtractKey = "demographics", Resolve = Latest };

    // "pick" CTEs use GROUP BY subject_id + argMax(field, submitted_at)
    // instead of ORDER BY ... LIMIT 1 BY subject_id — same "latest record
    // per subject" result, as a single hash aggregation instead of a sort.
    private const string BmiCte = """
          `bmi` AS (
            SELECT
              subject_id,
              argMax(data_points.id, data_points.submitted_at) AS `id`,
              max(data_points.submitted_at) AS `submitted_at`,
              argMax(data_points.payload.`bmi`::Float64, data_points.submitted_at) AS `bmi`
            FROM data_points
            WHERE data_extract_id = 'bmi'
            GROUP BY subject_id
          )
        """;

    private static string Sql(Visualisation viz) => VisualisationSqlBuilder.BuildSql(viz, Registry);

    [Fact]
    public void Distribution_Auto_BuildsServerSideHistogram()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "bmi-distribution",
            Title = "BMI Distribution",
            Extracts = [BmiLatest],
            Value = new FieldRef { Extract = "bmi", Field = "bmi" },
            Binning = new AutoBinningStrategy { Bins = 8 },
            Filters = [],
            Pagination = null,
        };

        var expected = $"""
            WITH
            {BmiCte}
            SELECT
              round(tupleElement(bin, 1), 2) AS `rangeStart`,
              round(tupleElement(bin, 2), 2) AS `rangeEnd`,
              tupleElement(bin, 3) AS `count`
            FROM (
                SELECT arrayJoin(histogram(8)(`bmi`.`bmi`)) AS bin
                FROM `bmi`
            )
            ORDER BY `rangeStart`
            """;

        Assert.Equal(expected, Sql(viz));
    }

    [Fact]
    public void Distribution_Auto_DefaultsTo8BinsAndAppliesFiltersInsideSubquery()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "bmi-distribution-filtered",
            Title = "BMI Distribution",
            Extracts = [BmiLatest],
            Value = new FieldRef { Extract = "bmi", Field = "bmi" },
            Filters = [new Filter { Extract = "bmi", Field = "bmi", Op = FilterOperator.GreaterThan, Value = JsonSerializer.SerializeToElement(18) }],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.Contains("SELECT arrayJoin(histogram(8)(`bmi`.`bmi`)) AS bin", sql);
        Assert.Contains("WHERE `bmi`.`bmi` > 18\n)", sql);
    }

    [Fact]
    public void Distribution_FixedWidth_EqualWidthBucketsOverExplicitRange()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "bmi-distribution-fixed",
            Title = "BMI Distribution",
            Extracts = [BmiLatest],
            Value = new FieldRef { Extract = "bmi", Field = "bmi" },
            Binning = new FixedWidthBinningStrategy { BinWidth = 5, Min = 15, Max = 45 },
            Filters = [],
            Pagination = null,
        };

        var expected = $"""
            WITH
            {BmiCte}
            SELECT
              round(15 + bucketIndex * 5, 2) AS `rangeStart`,
              round(15 + (bucketIndex + 1) * 5, 2) AS `rangeEnd`,
              toFloat64(count()) AS `count`
            FROM (
                SELECT least(greatest(floor((`bmi`.`bmi` - 15) / 5), 0), 5) AS bucketIndex
                FROM `bmi`
            )
            GROUP BY bucketIndex
            ORDER BY bucketIndex
            """;

        Assert.Equal(expected, Sql(viz));
    }

    [Fact]
    public void Distribution_Custom_NamedBucketsOrderedByDeclaredOrder()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "bmi-distribution-custom",
            Title = "BMI Distribution",
            Extracts = [BmiLatest],
            Value = new FieldRef { Extract = "bmi", Field = "bmi" },
            Binning = new CustomBinningStrategy
            {
                Buckets = [
                    new HistogramBucket { Label = "Underweight", Max = 18.5 },
                    new HistogramBucket { Label = "Normal", Max = 25 },
                    new HistogramBucket { Label = "Overweight", Max = 30 },
                    new HistogramBucket { Label = "Obese" },
                ],
            },
            Filters = [],
            Pagination = null,
        };

        var expected = $"""
            WITH
            {BmiCte}
            SELECT
              multiIf(`bmi`.`bmi` < 18.5, 'Underweight', `bmi`.`bmi` < 25, 'Normal', `bmi`.`bmi` < 30, 'Overweight', 'Obese') AS `category`,
              toFloat64(count()) AS `count`
            FROM `bmi`
            GROUP BY `category`, multiIf(`bmi`.`bmi` < 18.5, 0, `bmi`.`bmi` < 25, 1, `bmi`.`bmi` < 30, 2, 3)
            ORDER BY multiIf(`bmi`.`bmi` < 18.5, 0, `bmi`.`bmi` < 25, 1, `bmi`.`bmi` < 30, 2, 3)
            """;

        Assert.Equal(expected, Sql(viz));
    }

    [Fact]
    public void Bucket_TruncatesDateFieldForGroupedTimeSeries()
    {
        Visualisation viz = new LineVisualisation
        {
            Id = "avg-bmi-by-month",
            Title = "Average BMI by Month",
            Extracts = [BmiLatest],
            X = new FieldRef { Extract = "bmi", Field = "submitted_at", Bucket = DateBucket.Month },
            Y = [new FieldRef { Extract = "bmi", Field = "bmi", Aggregate = Aggregation.Avg }],
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.Contains("toStartOfMonth(`bmi`.`submitted_at`) AS `x`", sql);
        Assert.Contains("GROUP BY toStartOfMonth(`bmi`.`submitted_at`)", sql);
    }

    [Fact]
    public void Bar_JoinsExtracts_AggregatesY_GroupsByX()
    {
        Visualisation viz = new BarVisualisation
        {
            Id = "avg-bmi-by-sex",
            Title = "Average BMI by Sex",
            Extracts = [BmiLatest, DemoLatest],
            X = new FieldRef { Extract = "demographics", Field = "sex" },
            Y = [new FieldRef { Extract = "bmi", Field = "bmi", Aggregate = Aggregation.Avg }],
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.Contains("`demographics`.`sex` AS `x`", sql);
        // No Label was set on the Y measure, so it falls back to extract_field
        // rather than a canonical "y"/"value" — multiple Y measures couldn't
        // all share one fixed name, so none of them get one.
        Assert.Contains("avg(`bmi`.`bmi`) AS `bmi_bmi`", sql);
        Assert.Contains("INNER JOIN `demographics` ON `bmi`.subject_id = `demographics`.subject_id", sql);
        Assert.EndsWith("GROUP BY `demographics`.`sex`", sql);
    }

    [Fact]
    public void Bar_WithSeries_GroupsBySeriesAndX()
    {
        Visualisation viz = new BarVisualisation
        {
            Id = "avg-bmi-by-sex-and-family",
            Title = "Average BMI by Sex and Family",
            Extracts = [BmiLatest, DemoLatest],
            X = new FieldRef { Extract = "demographics", Field = "sex" },
            Series = new FieldRef { Extract = "demographics", Field = "familyName" },
            Y = [new FieldRef { Extract = "bmi", Field = "bmi", Aggregate = Aggregation.Avg }],
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.EndsWith("GROUP BY `demographics`.`familyName`, `demographics`.`sex`", sql);
    }

    [Fact]
    public void CountAggregate_IsCastToFloat64()
    {
        Visualisation viz = new PieVisualisation
        {
            Id = "subjects-by-sex",
            Title = "Subjects by Sex",
            Extracts = [DemoLatest],
            Category = new FieldRef { Extract = "demographics", Field = "sex" },
            Value = new FieldRef { Extract = "demographics", Field = "subject_id", Aggregate = Aggregation.Count },
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.Contains("toFloat64(count(`demographics`.`subject_id`)) AS `value`", sql);
    }

    [Fact]
    public void Line_AllResolve_SeriesXY_OrderedByX()
    {
        Visualisation viz = new LineVisualisation
        {
            Id = "bmi-trends",
            Title = "BMI Trends Over Time",
            Extracts = [
                new ExtractBinding
                {
                    DataExtractKey = "bmi",
                    Resolve = new AllResolveStrategy { OrderBy = new OrderBy { Field = "submitted_at", Direction = SortDirection.Asc } },
                },
            ],
            X = new FieldRef { Extract = "bmi", Field = "submitted_at" },
            Y = [new FieldRef { Extract = "bmi", Field = "bmi" }],
            Series = new FieldRef { Extract = "bmi", Field = "subject_id" },
            Filters = [],
            Pagination = null,
        };

        var expected = """
            WITH
              `bmi` AS (
                SELECT
                  subject_id,
                  data_points.id AS `id`,
                  data_points.submitted_at AS `submitted_at`,
                  data_points.payload.`bmi`::Float64 AS `bmi`
                FROM data_points
                WHERE data_extract_id = 'bmi'
                ORDER BY submitted_at ASC
              )
            SELECT
              `bmi`.`subject_id` AS `series`,
              `bmi`.`submitted_at` AS `x`,
              `bmi`.`bmi` AS `bmi_bmi`       
            FROM `bmi`
            ORDER BY `bmi`.`submitted_at` ASC
            """;

        Assert.Equal(expected, Sql(viz));
    }

    [Fact]
    public void Scatter_NoSeriesSampleSize_NoGroupingNoOrdering()
    {
        Visualisation viz = new ScatterVisualisation
        {
            Id = "bmi-vs-age",
            Title = "BMI vs Age",
            Extracts = [BmiLatest, DemoLatest],
            X = new FieldRef { Extract = "demographics", Field = "dateOfBirth" },
            Y = new FieldRef { Extract = "bmi", Field = "bmi" },
            Series = new FieldRef { Extract = "demographics", Field = "sex" },
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.DoesNotContain("\nGROUP BY", sql);
        Assert.DoesNotContain("\nORDER BY", sql);
        Assert.Contains("`demographics`.`dateOfBirth` AS `x`", sql);
    }

    [Fact]
    public void Scatter_WithSampleSize_RandomSamplesInsteadOfOrdering()
    {
        Visualisation viz = new ScatterVisualisation
        {
            Id = "bmi-vs-age-sampled",
            Title = "BMI vs Age",
            Extracts = [BmiLatest, DemoLatest],
            X = new FieldRef { Extract = "demographics", Field = "dateOfBirth" },
            Y = new FieldRef { Extract = "bmi", Field = "bmi" },
            SampleSize = 50,
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.EndsWith("ORDER BY rand()\nLIMIT 50", sql);
    }

    [Fact]
    public void Table_ExplicitColumnsKeepOwnAliases_FiltersSortPagination()
    {
        Visualisation viz = new TableVisualisation
        {
            Id = "filtered-table",
            Title = "Filtered",
            Extracts = [BmiLatest, DemoLatest],
            Columns = [new FieldRef { Extract = "bmi", Field = "bmi" }],
            Filters = [
                new Filter { Extract = "bmi", Field = "bmi", Op = FilterOperator.GreaterThan, Value = JsonSerializer.SerializeToElement(30) },
                new Filter { Extract = "demographics", Field = "sex", Op = FilterOperator.In, Value = JsonSerializer.SerializeToElement(new[] { "male", "female" }) },
                new Filter { Extract = "demographics", Field = "familyName", Op = FilterOperator.Contains, Value = JsonSerializer.SerializeToElement("son") },
            ],
            Sort = new Sort { Extract = "bmi", Field = "bmi", Direction = SortDirection.Desc },
            Pagination = new Pagination { Limit = 20, Offset = 40 },
        };

        var expected = $"""
            WITH
            {BmiCte},
              `demographics` AS (
                SELECT
                  subject_id,
                  argMax(data_points.id, data_points.submitted_at) AS `id`,
                  max(data_points.submitted_at) AS `submitted_at`,
                  argMax(data_points.payload.`sex`::String, data_points.submitted_at) AS `sex`,
                  argMax(data_points.payload.`familyName`::String, data_points.submitted_at) AS `familyName`
                FROM data_points
                WHERE data_extract_id = 'demographics'
                GROUP BY subject_id
              )
            SELECT
              `bmi`.`bmi` AS `bmi_bmi`
            FROM `bmi`
            INNER JOIN `demographics` ON `bmi`.subject_id = `demographics`.subject_id
            WHERE `bmi`.`bmi` > 30 AND `demographics`.`sex` IN ('male', 'female') AND `demographics`.`familyName` LIKE '%son%'
            ORDER BY `bmi`.`bmi` DESC
            LIMIT 20 OFFSET 40
            """;

        Assert.Equal(expected, Sql(viz));
    }

    [Fact]
    public void StringLiterals_AreEscapedAgainstInjection()
    {
        Visualisation viz = new TableVisualisation
        {
            Id = "escaping",
            Title = "Escaping",
            Extracts = [DemoLatest],
            Columns = [new FieldRef { Extract = "demographics", Field = "givenNames" }],
            Filters = [new Filter { Extract = "demographics", Field = "familyName", Op = FilterOperator.Equal, Value = JsonSerializer.SerializeToElement("O'Brien") }],
            Sort = null,
            Pagination = null,
        };

        Assert.Contains("= 'O''Brien'", Sql(viz));
    }

    [Fact]
    public void ThrowsOnUnknownField()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "bad-field",
            Title = "Bad field",
            Extracts = [BmiLatest],
            Value = new FieldRef { Extract = "bmi", Field = "nonsense" },
            Filters = [],
            Pagination = null,
        };

        var ex = Assert.Throws<InvalidOperationException>(() => Sql(viz));
        Assert.Contains("Unknown field 'nonsense'", ex.Message);
    }

    [Fact]
    public void ThrowsOnUnknownExtractAlias()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "bad-alias",
            Title = "Bad alias",
            Extracts = [BmiLatest],
            Value = new FieldRef { Extract = "missing", Field = "bmi" },
            Filters = [],
            Pagination = null,
        };

        var ex = Assert.Throws<InvalidOperationException>(() => Sql(viz));
        Assert.Contains("Unknown extract alias: 'missing'", ex.Message);
    }

    [Fact]
    public void Pick_WithAscDirection_UsesArgMinInsteadOfArgMax()
    {
        Visualisation viz = new DistributionVisualisation
        {
            Id = "earliest-bmi",
            Title = "Earliest BMI",
            Extracts = [
                new ExtractBinding
                {
                    DataExtractKey = "bmi",
                    Resolve = new PickResolveStrategy { By = new OrderBy { Field = "submitted_at", Direction = SortDirection.Asc } },
                },
            ],
            Value = new FieldRef { Extract = "bmi", Field = "bmi" },
            Filters = [],
            Pagination = null,
        };

        var sql = Sql(viz);
        Assert.Contains("argMin(data_points.id, data_points.submitted_at) AS `id`", sql);
        Assert.Contains("min(data_points.submitted_at) AS `submitted_at`", sql);
        Assert.Contains("argMin(data_points.payload.`bmi`::Float64, data_points.submitted_at) AS `bmi`", sql);
    }

    [Fact]
    public void BuildCountSql_CountsJoinedFilteredRows_IgnoringSelectAndLimit()
    {
        Visualisation viz = new TableVisualisation
        {
            Id = "filtered-table",
            Title = "Filtered",
            Extracts = [BmiLatest, DemoLatest],
            Columns = [new FieldRef { Extract = "bmi", Field = "bmi" }],
            Filters = [new Filter { Extract = "demographics", Field = "sex", Op = FilterOperator.Equal, Value = JsonSerializer.SerializeToElement("female") }],
            Sort = null,
            Pagination = new Pagination { Limit = 10, Offset = 20 },
        };

        var sql = VisualisationSqlBuilder.BuildCountSql(viz, Registry);
        Assert.Contains("SELECT toFloat64(count()) AS `total`", sql);
        Assert.Contains("WHERE `demographics`.`sex` = 'female'", sql);
        Assert.DoesNotContain("\nLIMIT", sql);
    }
}
