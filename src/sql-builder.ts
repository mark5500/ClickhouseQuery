import type { DataExtract, FieldType } from "./types.js";
import type {
  DateBucket,
  FieldRef,
  Filter,
  SortDirection,
  Visualisation,
  VisualisationExtract,
} from "./visualisation-schema.js";

// Columns that live on the data_points row itself rather than inside `payload`.
const DATAPOINT_FIELDS = new Set(["id", "subject_id", "submitted_at", "data_extract_id"]);

export type ExtractRegistry = Record<string, DataExtract>;

type FieldRefLike = { extract: string; field: string; bucket?: DateBucket };

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function literal(value: string | number | boolean): string {
  if (typeof value === "string") return quoteString(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function jsonExtractFn(type: FieldType): string {
  switch (type) {
    case "number":
      return "JSONExtractFloat";
    case "boolean":
      return "JSONExtractBool";
    case "string":
    case "date":
      return "JSONExtractString";
  }
}

function bucketFn(bucket: DateBucket): string {
  switch (bucket) {
    case "day":
      return "toDate";
    case "week":
      return "toStartOfWeek";
    case "month":
      return "toStartOfMonth";
  }
}

// Resolves a { extract: alias, field } reference to a SQL expression against the
// CTE aliased by `extract`. Datapoint fields are referenced directly; payload
// fields are pulled out with the JSONExtract function matching their type. A
// `bucket` truncates a date/datetime field to a coarser granularity.
function makeFieldResolver(viz: Visualisation, registry: ExtractRegistry) {
  const aliasToExtractId = new Map(viz.extracts.map((e) => [e.id, e.extract]));

  return (ref: FieldRefLike): string => {
    const { extract: alias, field } = ref;
    let expr: string;

    if (DATAPOINT_FIELDS.has(field)) {
      expr = `${alias}.${field}`;
    } else {
      const extractId = aliasToExtractId.get(alias);
      if (extractId === undefined) {
        throw new Error(`Unknown extract alias: '${alias}'`);
      }
      const def = registry[extractId];
      if (def === undefined) {
        throw new Error(`Unknown data extract: '${extractId}'`);
      }
      const fieldDef = def.fields.find((f) => f.name === field);
      if (fieldDef === undefined) {
        throw new Error(`Unknown field '${field}' on extract '${extractId}'`);
      }
      expr = `${jsonExtractFn(fieldDef.type)}(${alias}.payload, ${quoteString(field)})`;
    }

    return ref.bucket ? `${bucketFn(ref.bucket)}(${expr})` : expr;
  };
}

// Maps the channels of a typed visualisation onto a flat, ordered SELECT list
// plus an optional ORDER BY. Grouping is derived generically downstream: any
// non-aggregated select column becomes a GROUP BY key when an aggregate exists.
type Channels = {
  select: FieldRef[];
  orderBy: { ref: FieldRefLike; direction: SortDirection } | null;
};

// Chart types (everything but "table") always alias their channels to these
// fixed names, regardless of any `label` the caller set. This means a client
// never needs field-level metadata to render a chart — just its `type` and
// the canonical keys below.
function withCanonicalLabel(ref: FieldRef, label: string): FieldRef {
  return { ...ref, label };
}

function channelsFor(viz: Visualisation): Channels {
  switch (viz.type) {
    case "table":
      return {
        select: viz.columns,
        orderBy: viz.sort ? { ref: viz.sort, direction: viz.sort.direction } : null,
      };
    case "bar":
    case "pie": {
      const category = withCanonicalLabel(viz.category, "category");
      const value = withCanonicalLabel(viz.value, "value");
      const select =
        viz.type === "bar" && viz.series
          ? [category, withCanonicalLabel(viz.series, "series"), value]
          : [category, value];
      return { select, orderBy: null };
    }
    case "line":
    case "area":
    case "scatter": {
      const x = withCanonicalLabel(viz.x, "x");
      const y = withCanonicalLabel(viz.y, "y");
      const select = viz.series ? [withCanonicalLabel(viz.series, "series"), x, y] : [x, y];
      // A line/area chart is inherently ordered along its x axis; scatter isn't.
      const orderBy = viz.type === "scatter" ? null : { ref: x, direction: "asc" as const };
      return { select, orderBy };
    }
    case "distribution":
      // Distribution has its own query shape (see buildDistributionSql) since
      // it computes a server-side histogram rather than selecting raw rows.
      return { select: [], orderBy: null };
  }
}

function buildCte(extract: VisualisationExtract): string {
  const lines = [
    `  ${extract.id} AS (`,
    `    SELECT *`,
    `    FROM data_points`,
    `    WHERE data_extract_id = ${quoteString(extract.extract)}`,
  ];

  if (extract.resolve.strategy === "pick") {
    const { field, direction } = extract.resolve.by;
    lines.push(`    ORDER BY subject_id, ${field} ${direction.toUpperCase()}`);
    lines.push(`    LIMIT 1 BY subject_id`);
  } else {
    const { field, direction } = extract.resolve.orderBy;
    lines.push(`    ORDER BY ${field} ${direction.toUpperCase()}`);
  }

  lines.push(`  )`);
  return lines.join("\n");
}

function buildCtes(viz: Visualisation): string {
  return viz.extracts.map(buildCte).join(",\n");
}

// The alias a column resolves to in the result set — `label` if set, else
// `${extract}_${field}`. Exported so callers (e.g. the dashboard endpoint)
// can tell clients which key to read for a given table column without
// duplicating this convention.
export function columnAlias(col: FieldRef): string {
  return col.label ?? `${col.extract}_${col.field}`;
}

function buildColumn(col: FieldRef, resolve: (ref: FieldRefLike) => string): string {
  let expr = resolve(col);
  if (col.aggregate) {
    expr = `${col.aggregate}(${expr})`;
    // count()/sum() return UInt64, which ClickHouse's JSON formats serialize
    // as a string to avoid precision loss — cast so clients get a JS number.
    if (col.aggregate === "count" || col.aggregate === "sum") {
      expr = `toFloat64(${expr})`;
    }
  }
  return `${expr} AS ${quoteIdentifier(columnAlias(col))}`;
}

function buildFilter(filter: Filter, resolve: (ref: FieldRefLike) => string): string {
  const expr = resolve(filter);
  switch (filter.op) {
    case "in": {
      if (!Array.isArray(filter.value)) {
        throw new Error(`Filter 'in' on '${filter.field}' requires an array value`);
      }
      return `${expr} IN (${filter.value.map(literal).join(", ")})`;
    }
    case "contains":
      return `${expr} LIKE ${quoteString(`%${String(filter.value)}%`)}`;
    default:
      if (Array.isArray(filter.value)) {
        throw new Error(`Filter '${filter.op}' on '${filter.field}' requires a scalar value`);
      }
      return `${expr} ${filter.op} ${literal(filter.value)}`;
  }
}

// FROM <driving> INNER JOIN <rest> ON subject_id, plus an optional WHERE —
// shared by the main query, the distribution histogram subquery, and the
// table row-count query.
function buildFromAndWhere(
  viz: Visualisation,
  resolve: (ref: FieldRefLike) => string
): { fromClause: string; whereClause: string | null } {
  const [driving, ...joined] = viz.extracts;
  const fromLines = [`FROM ${driving.id}`];
  for (const extract of joined) {
    fromLines.push(`INNER JOIN ${extract.id} ON ${driving.id}.subject_id = ${extract.id}.subject_id`);
  }

  const whereClause =
    viz.filters.length > 0
      ? `WHERE ${viz.filters.map((f) => buildFilter(f, resolve)).join(" AND ")}`
      : null;

  return { fromClause: fromLines.join("\n"), whereClause };
}

function buildAutoHistogramSql(
  bins: number,
  ctes: string,
  fromClause: string,
  whereClause: string | null,
  valueExpr: string
): string {
  const innerLines = [`    SELECT arrayJoin(histogram(${bins})(${valueExpr})) AS bin`, `    ${fromClause}`];
  if (whereClause) innerLines.push(`    ${whereClause}`);

  return [
    `WITH\n${ctes}`,
    "SELECT",
    "  round(tupleElement(bin, 1), 2) AS `rangeStart`,",
    "  round(tupleElement(bin, 2), 2) AS `rangeEnd`,",
    "  tupleElement(bin, 3) AS `count`",
    "FROM (",
    innerLines.join("\n"),
    ")",
    "ORDER BY `rangeStart`",
  ].join("\n");
}

function buildFixedWidthHistogramSql(
  binWidth: number,
  min: number,
  max: number,
  ctes: string,
  fromClause: string,
  whereClause: string | null,
  valueExpr: string
): string {
  const binCount = Math.ceil((max - min) / binWidth);
  // Clamp out-of-range values into the first/last bucket rather than dropping them.
  const bucketIndexExpr = `least(greatest(floor((${valueExpr} - ${min}) / ${binWidth}), 0), ${binCount - 1})`;

  const innerLines = [`    SELECT ${bucketIndexExpr} AS bucketIndex`, `    ${fromClause}`];
  if (whereClause) innerLines.push(`    ${whereClause}`);

  return [
    `WITH\n${ctes}`,
    "SELECT",
    `  round(${min} + bucketIndex * ${binWidth}, 2) AS \`rangeStart\`,`,
    `  round(${min} + (bucketIndex + 1) * ${binWidth}, 2) AS \`rangeEnd\`,`,
    "  toFloat64(count()) AS `count`",
    "FROM (",
    innerLines.join("\n"),
    ")",
    "GROUP BY bucketIndex",
    "ORDER BY bucketIndex",
  ].join("\n");
}

// Named bands (e.g. WHO BMI categories) via a `multiIf` chain — each bucket
// tests `value < max`, in order, first match wins. A second `multiIf` over
// the same boundaries produces a hidden sort key so results come back in
// the buckets' declared order rather than alphabetically by label.
function buildCustomBucketsSql(
  buckets: { label: string; max?: number }[],
  ctes: string,
  fromClause: string,
  whereClause: string | null,
  valueExpr: string
): string {
  const conditions = (mapValue: (bucket: { label: string; max?: number }, index: number) => string) => {
    const args: string[] = [];
    buckets.slice(0, -1).forEach((bucket, i) => {
      args.push(`${valueExpr} < ${bucket.max}`, mapValue(bucket, i));
    });
    args.push(mapValue(buckets[buckets.length - 1], buckets.length - 1));
    return `multiIf(${args.join(", ")})`;
  };

  const categoryExpr = conditions((bucket) => quoteString(bucket.label));
  // Not selected — only used to GROUP/ORDER BY so buckets come back in their
  // declared order rather than alphabetically by label.
  const orderExpr = conditions((_bucket, i) => String(i));

  const parts = [
    `WITH\n${ctes}`,
    "SELECT",
    `  ${categoryExpr} AS \`category\`,`,
    "  toFloat64(count()) AS `count`",
    fromClause,
  ];
  if (whereClause) parts.push(whereClause);
  parts.push(`GROUP BY \`category\`, ${orderExpr}`);
  parts.push(`ORDER BY ${orderExpr}`);
  return parts.join("\n");
}

// Distribution computes a server-side histogram instead of returning one row
// per underlying value. The `binning` strategy picks how: ClickHouse's
// adaptive histogram(), equal-width bins over an explicit range, or named
// bands with explicit boundaries.
function buildDistributionSql(
  viz: Extract<Visualisation, { type: "distribution" }>,
  ctes: string,
  fromClause: string,
  whereClause: string | null,
  resolve: (ref: FieldRefLike) => string
): string {
  const valueExpr = resolve(viz.value);
  const binning = viz.binning ?? { strategy: "auto" as const };

  switch (binning.strategy) {
    case "auto":
      return buildAutoHistogramSql(binning.bins ?? 8, ctes, fromClause, whereClause, valueExpr);
    case "fixed-width":
      return buildFixedWidthHistogramSql(
        binning.binWidth,
        binning.min,
        binning.max,
        ctes,
        fromClause,
        whereClause,
        valueExpr
      );
    case "custom":
      return buildCustomBucketsSql(binning.buckets, ctes, fromClause, whereClause, valueExpr);
  }
}

export function buildSql(viz: Visualisation, registry: ExtractRegistry): string {
  const resolve = makeFieldResolver(viz, registry);
  const ctes = buildCtes(viz);
  const { fromClause, whereClause } = buildFromAndWhere(viz, resolve);

  if (viz.type === "distribution") {
    return buildDistributionSql(viz, ctes, fromClause, whereClause, resolve);
  }

  const { select, orderBy } = channelsFor(viz);

  const selectList = select.map((col) => `  ${buildColumn(col, resolve)}`).join(",\n");
  const parts = [`WITH\n${ctes}`, `SELECT\n${selectList}`, fromClause];

  if (whereClause) {
    parts.push(whereClause);
  }

  // GROUP BY <non-aggregated columns> (only when aggregating)
  const hasAggregate = select.some((col) => col.aggregate);
  if (hasAggregate) {
    const groupExprs = select.filter((col) => !col.aggregate).map((col) => resolve(col));
    if (groupExprs.length > 0) {
      parts.push(`GROUP BY ${groupExprs.join(", ")}`);
    }
  }

  // A scatter's `sampleSize` takes priority over any explicit order/pagination
  // — it's a random sample, not a stable page of results.
  if (viz.type === "scatter" && viz.sampleSize) {
    parts.push("ORDER BY rand()");
    parts.push(`LIMIT ${viz.sampleSize}`);
    return parts.join("\n");
  }

  // ORDER BY <channel-derived or explicit sort>
  if (orderBy) {
    parts.push(`ORDER BY ${resolve(orderBy.ref)} ${orderBy.direction.toUpperCase()}`);
  }

  // LIMIT / OFFSET
  if (viz.pagination) {
    parts.push(`LIMIT ${viz.pagination.limit} OFFSET ${viz.pagination.offset}`);
  }

  return parts.join("\n");
}

// Total row count for a visualisation's FROM/JOIN/WHERE pipeline, ignoring
// SELECT/GROUP BY/LIMIT. Used to paginate table results.
export function buildCountSql(viz: Visualisation, registry: ExtractRegistry): string {
  const resolve = makeFieldResolver(viz, registry);
  const ctes = buildCtes(viz);
  const { fromClause, whereClause } = buildFromAndWhere(viz, resolve);

  const parts = [`WITH\n${ctes}`, "SELECT toFloat64(count()) AS `total`", fromClause];
  if (whereClause) parts.push(whereClause);
  return parts.join("\n");
}
