import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCountSql, buildSql, type ExtractRegistry } from "./sql-builder.js";
import { bmiDataExtract, demographicsDataExtract } from "./types.js";
import { parseVisualisation, type Visualisation } from "./visualisation-schema.js";

const registry: ExtractRegistry = {
  bmi: bmiDataExtract,
  demographics: demographicsDataExtract,
};

const latest = { strategy: "pick", by: { field: "submitted_at", direction: "desc" } } as const;

const bmiLatest = { id: "bmi", extract: "bmi", resolve: latest } as const;
const demoLatest = { id: "demo", extract: "demographics", resolve: latest } as const;

test("distribution (auto): builds a server-side histogram, not raw values", () => {
  const viz: Visualisation = {
    id: "bmi-distribution",
    type: "distribution",
    title: "BMI Distribution",
    extracts: [bmiLatest],
    value: { extract: "bmi", field: "bmi" },
    binning: { strategy: "auto", bins: 8 },
    filters: [],
    pagination: null,
  };

  assert.equal(
    buildSql(viz, registry),
    `WITH
  bmi AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  )
SELECT
  round(tupleElement(bin, 1), 2) AS \`rangeStart\`,
  round(tupleElement(bin, 2), 2) AS \`rangeEnd\`,
  tupleElement(bin, 3) AS \`count\`
FROM (
    SELECT arrayJoin(histogram(8)(JSONExtractFloat(bmi.payload, 'bmi'))) AS bin
    FROM bmi
)
ORDER BY \`rangeStart\``
  );
});

test("distribution (auto): defaults to 8 bins and applies filters inside the subquery", () => {
  const viz: Visualisation = {
    id: "bmi-distribution-filtered",
    type: "distribution",
    title: "BMI Distribution",
    extracts: [bmiLatest],
    value: { extract: "bmi", field: "bmi" },
    filters: [{ extract: "bmi", field: "bmi", op: ">", value: 18 }],
    pagination: null,
  };

  const sql = buildSql(viz, registry);
  assert.match(sql, /FROM \(\n {4}SELECT arrayJoin\(histogram\(8\)/);
  assert.match(sql, /WHERE JSONExtractFloat\(bmi\.payload, 'bmi'\) > 18\n\)/);
});

test("distribution (fixed-width): equal-width buckets over an explicit range", () => {
  const viz: Visualisation = {
    id: "bmi-distribution-fixed",
    type: "distribution",
    title: "BMI Distribution",
    extracts: [bmiLatest],
    value: { extract: "bmi", field: "bmi" },
    binning: { strategy: "fixed-width", binWidth: 5, min: 15, max: 45 },
    filters: [],
    pagination: null,
  };

  assert.equal(
    buildSql(viz, registry),
    `WITH
  bmi AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  )
SELECT
  round(15 + bucketIndex * 5, 2) AS \`rangeStart\`,
  round(15 + (bucketIndex + 1) * 5, 2) AS \`rangeEnd\`,
  toFloat64(count()) AS \`count\`
FROM (
    SELECT least(greatest(floor((JSONExtractFloat(bmi.payload, 'bmi') - 15) / 5), 0), 5) AS bucketIndex
    FROM bmi
)
GROUP BY bucketIndex
ORDER BY bucketIndex`
  );
});

test("distribution (custom): named buckets via multiIf, ordered by declared order not alphabetically", () => {
  const viz: Visualisation = {
    id: "bmi-distribution-custom",
    type: "distribution",
    title: "BMI Distribution",
    extracts: [bmiLatest],
    value: { extract: "bmi", field: "bmi" },
    binning: {
      strategy: "custom",
      buckets: [
        { label: "Underweight", max: 18.5 },
        { label: "Normal", max: 25 },
        { label: "Overweight", max: 30 },
        { label: "Obese" },
      ],
    },
    filters: [],
    pagination: null,
  };

  assert.equal(
    buildSql(viz, registry),
    `WITH
  bmi AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  )
SELECT
  multiIf(JSONExtractFloat(bmi.payload, 'bmi') < 18.5, 'Underweight', JSONExtractFloat(bmi.payload, 'bmi') < 25, 'Normal', JSONExtractFloat(bmi.payload, 'bmi') < 30, 'Overweight', 'Obese') AS \`category\`,
  toFloat64(count()) AS \`count\`
FROM bmi
GROUP BY \`category\`, multiIf(JSONExtractFloat(bmi.payload, 'bmi') < 18.5, 0, JSONExtractFloat(bmi.payload, 'bmi') < 25, 1, JSONExtractFloat(bmi.payload, 'bmi') < 30, 2, 3)
ORDER BY multiIf(JSONExtractFloat(bmi.payload, 'bmi') < 18.5, 0, JSONExtractFloat(bmi.payload, 'bmi') < 25, 1, JSONExtractFloat(bmi.payload, 'bmi') < 30, 2, 3)`
  );
});

test("distribution (custom): rejects a non-last bucket missing 'max'", () => {
  assert.throws(() =>
    parseVisualisation({
      id: "bad-buckets",
      type: "distribution",
      title: "Bad",
      extracts: [bmiLatest],
      value: { extract: "bmi", field: "bmi" },
      binning: {
        strategy: "custom",
        buckets: [{ label: "A" }, { label: "B", max: 10 }],
      },
      filters: [],
      pagination: null,
    })
  );
});

test("bucket truncates a date field for grouped time-series aggregation", () => {
  const viz: Visualisation = {
    id: "avg-bmi-by-month",
    type: "line",
    title: "Average BMI by Month",
    extracts: [bmiLatest],
    x: { extract: "bmi", field: "submitted_at", bucket: "month" },
    y: { extract: "bmi", field: "bmi", aggregate: "avg" },
    filters: [],
    pagination: null,
  };

  const sql = buildSql(viz, registry);
  assert.match(sql, /toStartOfMonth\(bmi\.submitted_at\) AS `x`/);
  assert.match(sql, /GROUP BY toStartOfMonth\(bmi\.submitted_at\)/);
});

test("bar: joins extracts, aggregates value, groups by category, canonical aliases", () => {
  const viz: Visualisation = {
    id: "avg-bmi-by-sex",
    type: "bar",
    title: "Average BMI by Sex",
    extracts: [bmiLatest, demoLatest],
    category: { extract: "demo", field: "sex" },
    value: { extract: "bmi", field: "bmi", aggregate: "avg", label: "ignored, overridden by canonical alias" },
    filters: [],
    pagination: null,
  };

  assert.equal(
    buildSql(viz, registry),
    `WITH
  bmi AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  ),
  demo AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'demographics'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  )
SELECT
  JSONExtractString(demo.payload, 'sex') AS \`category\`,
  avg(JSONExtractFloat(bmi.payload, 'bmi')) AS \`value\`
FROM bmi
INNER JOIN demo ON bmi.subject_id = demo.subject_id
GROUP BY JSONExtractString(demo.payload, 'sex')`
  );
});

test("bar with series: groups by category and series", () => {
  const viz: Visualisation = {
    id: "avg-bmi-by-sex-and-family",
    type: "bar",
    title: "Average BMI by Sex and Family",
    extracts: [bmiLatest, demoLatest],
    category: { extract: "demo", field: "sex" },
    series: { extract: "demo", field: "familyName" },
    value: { extract: "bmi", field: "bmi", aggregate: "avg" },
    filters: [],
    pagination: null,
  };

  const sql = buildSql(viz, registry);
  assert.match(
    sql,
    /GROUP BY JSONExtractString\(demo\.payload, 'sex'\), JSONExtractString\(demo\.payload, 'familyName'\)$/
  );
});

test("count aggregate is cast to Float64 to avoid UInt64 string serialization", () => {
  const viz: Visualisation = {
    id: "subjects-by-sex",
    type: "pie",
    title: "Subjects by Sex",
    extracts: [demoLatest],
    category: { extract: "demo", field: "sex" },
    value: { extract: "demo", field: "subject_id", aggregate: "count" },
    filters: [],
    pagination: null,
  };

  const sql = buildSql(viz, registry);
  assert.match(sql, /toFloat64\(count\(demo\.subject_id\)\) AS `value`/);
});

test("line: 'all' resolve, series + x + y, ordered by x, canonical aliases", () => {
  const viz: Visualisation = {
    id: "bmi-trends",
    type: "line",
    title: "BMI Trends Over Time",
    extracts: [
      {
        id: "bmi",
        extract: "bmi",
        resolve: { strategy: "all", orderBy: { field: "submitted_at", direction: "asc" } },
      },
    ],
    x: { extract: "bmi", field: "submitted_at" },
    y: { extract: "bmi", field: "bmi" },
    series: { extract: "bmi", field: "subject_id" },
    filters: [],
    pagination: null,
  };

  assert.equal(
    buildSql(viz, registry),
    `WITH
  bmi AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY submitted_at ASC
  )
SELECT
  bmi.subject_id AS \`series\`,
  bmi.submitted_at AS \`x\`,
  JSONExtractFloat(bmi.payload, 'bmi') AS \`y\`
FROM bmi
ORDER BY bmi.submitted_at ASC`
  );
});

test("scatter: x + y + series, no grouping, no ordering, canonical aliases", () => {
  const viz: Visualisation = {
    id: "bmi-vs-age",
    type: "scatter",
    title: "BMI vs Age",
    extracts: [bmiLatest, demoLatest],
    x: { extract: "demo", field: "dateOfBirth" },
    y: { extract: "bmi", field: "bmi" },
    series: { extract: "demo", field: "sex" },
    filters: [],
    pagination: null,
  };

  const sql = buildSql(viz, registry);
  assert.doesNotMatch(sql, /\nGROUP BY/); // no top-level GROUP BY
  assert.doesNotMatch(sql, /\nORDER BY/); // no top-level ORDER BY (CTE ones are indented)
  assert.match(sql, /JSONExtractString\(demo\.payload, 'dateOfBirth'\) AS `x`/);
});

test("table: explicit columns keep their own aliases, filters, sort, pagination", () => {
  const viz: Visualisation = {
    id: "filtered-table",
    type: "table",
    title: "Filtered",
    extracts: [bmiLatest, demoLatest],
    columns: [{ extract: "bmi", field: "bmi" }],
    filters: [
      { extract: "bmi", field: "bmi", op: ">", value: 30 },
      { extract: "demo", field: "sex", op: "in", value: ["male", "female"] },
      { extract: "demo", field: "familyName", op: "contains", value: "son" },
    ],
    sort: { extract: "bmi", field: "bmi", direction: "desc" },
    pagination: { limit: 20, offset: 40 },
  };

  assert.equal(
    buildSql(viz, registry),
    `WITH
  bmi AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  ),
  demo AS (
    SELECT *
    FROM data_points
    WHERE data_extract_id = 'demographics'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
  )
SELECT
  JSONExtractFloat(bmi.payload, 'bmi') AS \`bmi_bmi\`
FROM bmi
INNER JOIN demo ON bmi.subject_id = demo.subject_id
WHERE JSONExtractFloat(bmi.payload, 'bmi') > 30 AND JSONExtractString(demo.payload, 'sex') IN ('male', 'female') AND JSONExtractString(demo.payload, 'familyName') LIKE '%son%'
ORDER BY JSONExtractFloat(bmi.payload, 'bmi') DESC
LIMIT 20 OFFSET 40`
  );
});

test("string literals are escaped against injection", () => {
  const viz: Visualisation = {
    id: "escaping",
    type: "table",
    title: "Escaping",
    extracts: [demoLatest],
    columns: [{ extract: "demo", field: "givenNames" }],
    filters: [{ extract: "demo", field: "familyName", op: "=", value: "O'Brien" }],
    sort: null,
    pagination: null,
  };

  assert.match(buildSql(viz, registry), /= 'O''Brien'/);
});

test("throws on unknown field", () => {
  const viz: Visualisation = {
    id: "bad-field",
    type: "distribution",
    title: "Bad field",
    extracts: [bmiLatest],
    value: { extract: "bmi", field: "nonsense" },
    filters: [],
    pagination: null,
  };

  assert.throws(() => buildSql(viz, registry), /Unknown field 'nonsense'/);
});

test("throws on unknown extract alias", () => {
  const viz: Visualisation = {
    id: "bad-alias",
    type: "distribution",
    title: "Bad alias",
    extracts: [bmiLatest],
    value: { extract: "missing", field: "bmi" },
    filters: [],
    pagination: null,
  };

  assert.throws(() => buildSql(viz, registry), /Unknown extract alias: 'missing'/);
});

test("buildCountSql counts the joined/filtered rows, ignoring select/limit", () => {
  const viz: Visualisation = {
    id: "filtered-table",
    type: "table",
    title: "Filtered",
    extracts: [bmiLatest, demoLatest],
    columns: [{ extract: "bmi", field: "bmi" }],
    filters: [{ extract: "demo", field: "sex", op: "=", value: "female" }],
    sort: null,
    pagination: { limit: 10, offset: 20 },
  };

  const sql = buildCountSql(viz, registry);
  assert.match(sql, /SELECT toFloat64\(count\(\)\) AS `total`/);
  assert.match(sql, /WHERE JSONExtractString\(demo\.payload, 'sex'\) = 'female'/);
  assert.doesNotMatch(sql, /\nLIMIT \d+ OFFSET/); // pagination ignored (CTEs' own `LIMIT 1 BY` is fine)
});

// --- schema validation ----------------------------------------------------

test("parseVisualisation accepts a valid bar visualisation", () => {
  const parsed = parseVisualisation({
    id: "avg-bmi-by-sex",
    type: "bar",
    title: "Average BMI by Sex",
    extracts: [{ id: "bmi", extract: "bmi", resolve: latest }],
    category: { extract: "bmi", field: "sex" },
    value: { extract: "bmi", field: "bmi", aggregate: "avg" },
    filters: [],
    pagination: null,
  });
  assert.equal(parsed.type, "bar");
});

test("parseVisualisation rejects a visualisation missing an id", () => {
  assert.throws(() =>
    parseVisualisation({
      type: "bar",
      title: "No id",
      extracts: [{ id: "bmi", extract: "bmi", resolve: latest }],
      category: { extract: "bmi", field: "sex" },
      value: { extract: "bmi", field: "bmi", aggregate: "avg" },
      filters: [],
      pagination: null,
    })
  );
});

test("parseVisualisation rejects a bar missing its required channels", () => {
  assert.throws(() =>
    parseVisualisation({
      id: "broken",
      type: "bar",
      title: "Broken",
      extracts: [{ id: "bmi", extract: "bmi", resolve: latest }],
      // no category / value
      filters: [],
      pagination: null,
    })
  );
});

test("parseVisualisation rejects line channels on a pie type", () => {
  assert.throws(() =>
    parseVisualisation({
      id: "wrong-channels",
      type: "pie",
      title: "Wrong channels",
      extracts: [{ id: "bmi", extract: "bmi", resolve: latest }],
      x: { extract: "bmi", field: "submitted_at" },
      y: { extract: "bmi", field: "bmi" },
      filters: [],
      pagination: null,
    })
  );
});
