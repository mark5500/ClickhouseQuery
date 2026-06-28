using System.Text.Json;
using QueryBuilder.Visualisations;
using Xunit;

namespace QueryBuilder.Visualisations.Tests;

public class VisualisationSerializationTests
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [Fact]
    public void ScatterVisualisation_RoundTripsThroughJson()
    {
        var bmiLatest = new ExtractBinding
        {
            DataExtractKey = "bmi",
            Resolve = new PickResolveStrategy { By = new OrderBy { Field = "submitted_at", Direction = SortDirection.Desc } },
        };
        var demoLatest = new ExtractBinding
        {
            DataExtractKey = "demo",
            Resolve = new PickResolveStrategy { By = new OrderBy { Field = "submitted_at", Direction = SortDirection.Desc } },
        };

        Visualisation original = new ScatterVisualisation
        {
            Id = "bmi-vs-age",
            Title = "BMI vs Date of Birth",
            Extracts = [bmiLatest, demoLatest],
            X = new FieldRef { Extract = "demo", Field = "dateOfBirth" },
            Y = new FieldRef { Extract = "bmi", Field = "bmi" },
            Series = new FieldRef { Extract = "demo", Field = "sex" },
            SampleSize = 50,
            Filters = [],
            Pagination = null,
        };

        var json = JsonSerializer.Serialize(original, Options);

        Assert.Contains("\"type\":\"scatter\"", json);
        Assert.Contains("\"strategy\":\"pick\"", json);
        Assert.Contains("\"sampleSize\":50", json);

        var roundTripped = JsonSerializer.Deserialize<Visualisation>(json, Options);

        Assert.IsType<ScatterVisualisation>(roundTripped);
        Assert.Equal(json, JsonSerializer.Serialize(roundTripped, Options));
    }

    [Fact]
    public void DistributionVisualisation_WithCustomBuckets_RoundTripsThroughJson()
    {
        Visualisation original = new DistributionVisualisation
        {
            Id = "bmi-distribution",
            Title = "BMI Distribution",
            Extracts =
            [
                new ExtractBinding
                {
                    DataExtractKey = "bmi",
                    Resolve = new PickResolveStrategy { By = new OrderBy { Field = "submitted_at", Direction = SortDirection.Desc } },
                },
            ],
            Value = new FieldRef { Extract = "bmi", Field = "bmi" },
            Binning = new CustomBinningStrategy
            {
                Buckets =
                [
                    new HistogramBucket { Label = "Underweight", Max = 18.5 },
                    new HistogramBucket { Label = "Normal", Max = 25 },
                    new HistogramBucket { Label = "Overweight", Max = 30 },
                    new HistogramBucket { Label = "Obese" },
                ],
            },
            Filters = [],
            Pagination = null,
        };

        var json = JsonSerializer.Serialize(original, Options);
        Assert.Contains("\"strategy\":\"custom\"", json);

        var roundTripped = JsonSerializer.Deserialize<Visualisation>(json, Options);
        Assert.Equal(json, JsonSerializer.Serialize(roundTripped, Options));
    }
    
    [Fact]
    public void FilterOperator_SerializesAsSymbol()
    {
        var filter = new Filter
        {
            Extract = "demo",
            Field = "sex",
            Op = FilterOperator.NotEqual,
            Value = JsonSerializer.SerializeToElement("unknown"),
        };

        var json = JsonSerializer.Serialize(filter, Options);

        Assert.Contains("\"op\":\"!=\"", json);
    }
}
