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

// `payload` is a native ClickHouse JSON column, so a path is read as a typed
// sub-column (e.g. `bmi.payload.\`bmi\`::Float64`) rather than parsed out of a
// String at query time — this is the cast type for each domain field type.
function jsonCastType(type: FieldType): string {
  switch (type) {
    case "number":
      return "Float64";
    case "boolean":
      return "Bool";
    case "string":
    case "date":
      return "String";
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

// Every field a visualisation touches — select channels, filters, table sort
// — across every type. Used both to validate aliases/fields up front and to
// work out which payload paths each CTE actually needs to project.
function collectFieldRefs(viz: Visualisation): FieldRefLike[] {
  const refs: FieldRefLike[] = [...viz.filters];
  switch (viz.type) {
    case "table":
      refs.push(...viz.columns);
      if (viz.sort) refs.push(viz.sort);
      break;
    case "bar":
      refs.push(viz.category, viz.value);
      if (viz.series) refs.push(viz.series);
      break;
    case "pie":
      refs.push(viz.category, viz.value);
      break;
    case "line":
    case "area":
    case "scatter":
      refs.push(viz.x, viz.y);
      if (viz.series) refs.push(viz.series);
      break;
    case "distribution":
      refs.push(viz.value);
      break;
  }
  return refs;
}

// Fails fast — and with the same error messages callers already depend on —
// before any SQL is built, rather than discovering a bad alias/field via a
// ClickHouse error at execution time.
function validateFieldRefs(viz: Visualisation, registry: ExtractRegistry): void {
  const aliasToExtractId = new Map(viz.extracts.map((e) => [e.id, e.extract]));

  for (const ref of collectFieldRefs(viz)) {
    if (DATAPOINT_FIELDS.has(ref.field)) continue;

    const extractId = aliasToExtractId.get(ref.extract);
    if (extractId === undefined) {
      throw new Error(`Unknown extract alias: '${ref.extract}'`);
    }
    const def = registry[extractId];
    if (def === undefined) {
      throw new Error(`Unknown data extract: '${extractId}'`);
    }
    if (!def.fields.some((f) => f.name === ref.field)) {
      throw new Error(`Unknown field '${ref.field}' on extract '${extractId}'`);
    }
  }
}

// Which payload fields each extract alias's CTE needs to project, derived
// from every reference to that alias across the whole visualisation. Lets
// each CTE select only the JSON sub-columns it actually needs instead of the
// whole payload, which is what makes JSON sub-column pruning possible.
function payloadFieldsByAlias(viz: Visualisation): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const ref of collectFieldRefs(viz)) {
    if (DATAPOINT_FIELDS.has(ref.field)) continue;
    const set = map.get(ref.extract) ?? new Set<string>();
    set.add(ref.field);
    map.set(ref.extract, set);
  }
  return map;
}

// Resolves a { extract: alias, field } reference to a SQL expression. Every
// field — datapoint or payload — is already a plain, typed column on the
// CTE by this point (see buildCte), so resolution is just `alias.field`. A
// `bucket` truncates a date/datetime field to a coarser granularity.
function makeFieldResolver() {
  return (ref: FieldRefLike): string => {
    const expr = `${ref.extract}.${quoteIdentifier(ref.field)}`;
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

// Projects only the datapoint columns plus the specific payload sub-columns
// this visualisation references — not `SELECT *` — so ClickHouse only reads
// the JSON paths actually needed instead of the whole payload structure.
//
// "pick" (latest/earliest record per subject) is implemented as
// `GROUP BY subject_id` + `argMax`/`argMin`, not `ORDER BY ... LIMIT 1 BY
// subject_id`. Both pick the same row per subject, but LIMIT BY forces a
// full sort of every matching row before it can dedupe, while argMax/argMin
// is a single hash aggregation — substantially cheaper at scale (measured
// ~3x faster on this project's data).
//
// Deliberately doesn't project `data_extract_id` (constant per CTE, never
// referenced downstream): mixing a literal constant column into a SELECT
// alongside multiple aggregates that share a comparator (argMax/max keyed
// on the same `submitted_at`) under GROUP BY corrupted ~78% of rows in
// testing on ClickHouse 24.8.14 — silently, with no error. Reproduced
// deterministically with both String and native-JSON `payload` columns, so
// it's a GROUP BY/constant-folding issue, not specific to either. If a
// future field genuinely needs a constant projected here, verify against a
// real `GROUP BY` (not just a small LIMIT) first.
function buildCte(extract: VisualisationExtract, neededFields: Set<string>, registry: ExtractRegistry): string {
  const def = registry[extract.extract];
  if (def === undefined) {
    throw new Error(`Unknown data extract: '${extract.extract}'`);
  }

  // Table-qualified: when this field's own output alias has the same name
  // as the source column (e.g. `max(submitted_at) AS submitted_at`),
  // ClickHouse resolves a later *bare* reference to that alias instead of
  // the underlying column — which then trips "aggregate inside aggregate"
  // once that reference is itself wrapped in another aggregate (argMax's
  // second argument). Qualifying with `data_points.` sidesteps it.
  const sourceExpr = (field: string): string => {
    if (DATAPOINT_FIELDS.has(field)) return `data_points.${field}`;
    const fieldDef = def.fields.find((f) => f.name === field);
    if (fieldDef === undefined) {
      throw new Error(`Unknown field '${field}' on extract '${extract.extract}'`);
    }
    return `data_points.payload.${quoteIdentifier(field)}::${jsonCastType(fieldDef.type)}`;
  };

  // `id`/`submitted_at` are always projected even if no channel references
  // them directly — `submitted_at` in particular is needed internally to
  // pick the latest/earliest record per subject.
  const otherFields = Array.from(new Set(["id", "submitted_at", ...neededFields]));

  const lines = [`  ${extract.id} AS (`];

  if (extract.resolve.strategy === "pick") {
    const { field: byField, direction } = extract.resolve.by;
    const pickFn = direction === "desc" ? "argMax" : "argMin";
    const pickScalarFn = direction === "desc" ? "max" : "min";
    const byExpr = sourceExpr(byField);

    const columns = otherFields.map((field) => {
      const expr = sourceExpr(field);
      const agg = field === byField ? `${pickScalarFn}(${expr})` : `${pickFn}(${expr}, ${byExpr})`;
      return `${agg} AS ${quoteIdentifier(field)}`;
    });

    lines.push(
      `    SELECT`,
      `      subject_id,`,
      `      ${columns.join(",\n      ")}`,
      `    FROM data_points`,
      `    WHERE data_extract_id = ${quoteString(extract.extract)}`,
      `    GROUP BY subject_id`
    );
  } else {
    const { field, direction } = extract.resolve.orderBy;
    const columns = otherFields.map((f) => `${sourceExpr(f)} AS ${quoteIdentifier(f)}`);

    lines.push(
      `    SELECT`,
      `      subject_id,`,
      `      ${columns.join(",\n      ")}`,
      `    FROM data_points`,
      `    WHERE data_extract_id = ${quoteString(extract.extract)}`,
      `    ORDER BY ${field} ${direction.toUpperCase()}`
    );
  }

  lines.push(`  )`);
  return lines.join("\n");
}

function buildCtes(viz: Visualisation, registry: ExtractRegistry): string {
  const fieldsByAlias = payloadFieldsByAlias(viz);
  return viz.extracts
    .map((extract) => buildCte(extract, fieldsByAlias.get(extract.id) ?? new Set(), registry))
    .join(",\n");
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
  validateFieldRefs(viz, registry);
  const resolve = makeFieldResolver();
  const ctes = buildCtes(viz, registry);
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
  validateFieldRefs(viz, registry);
  const resolve = makeFieldResolver();
  const ctes = buildCtes(viz, registry);
  const { fromClause, whereClause } = buildFromAndWhere(viz, resolve);

  const parts = [`WITH\n${ctes}`, "SELECT toFloat64(count()) AS `total`", fromClause];
  if (whereClause) parts.push(whereClause);
  return parts.join("\n");
}
