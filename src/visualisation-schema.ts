import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export const sortDirection = z.enum(["asc", "desc"]);

export const orderBy = z.object({
  field: z.string(),
  direction: sortDirection,
});

// How to resolve multiple submissions per subject down to the grain a
// visualisation needs (see notes in the original DataExtract resolve design).
export const resolveStrategy = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("all"), orderBy }),
  z.object({ strategy: z.literal("pick"), by: orderBy }),
]);

export const visualisationExtract = z.object({
  id: z.string(),
  extract: z.string(),
  resolve: resolveStrategy,
});

export const aggregation = z.enum(["count", "avg", "sum", "min", "max"]);

export const dateBucket = z.enum(["day", "week", "month"]);

// A reference to a field by extract alias. `field` may be a payload field
// ("bmi", "sex") or a datapoint field ("subject_id", "submitted_at"). `bucket`
// truncates a date/datetime field to a coarser granularity — typically used
// on a time axis so it can be grouped/aggregated over (e.g. avg per month).
export const fieldRef = z.object({
  extract: z.string(),
  field: z.string(),
  aggregate: aggregation.optional(),
  bucket: dateBucket.optional(),
  label: z.string().optional(),
});

export const filterOperator = z.enum(["=", "!=", "<", "<=", ">", ">=", "in", "contains"]);

export const filter = z.object({
  extract: z.string(),
  field: z.string(),
  op: filterOperator,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});

export const sort = z.object({
  extract: z.string(),
  field: z.string(),
  direction: sortDirection,
});

export const pagination = z.object({
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

// A named band with an upper bound — e.g. WHO BMI categories. The bucket
// catches values < max; the last bucket in the list should omit `max` so it
// catches everything above the previous one.
export const histogramBucket = z.object({
  label: z.string(),
  max: z.number().optional(),
});

export const binningStrategy = z.discriminatedUnion("strategy", [
  // ClickHouse's adaptive histogram() — picks its own (unequal-width) bins.
  z.object({ strategy: z.literal("auto"), bins: z.number().int().positive().optional() }),
  // Equal-width bins over an explicit range.
  z.object({
    strategy: z.literal("fixed-width"),
    binWidth: z.number().positive(),
    min: z.number(),
    max: z.number(),
  }),
  // Named bands with explicit boundaries, e.g. WHO BMI categories.
  z
    .object({ strategy: z.literal("custom"), buckets: z.array(histogramBucket).min(1) })
    .superRefine((data, ctx) => {
      data.buckets.slice(0, -1).forEach((bucket, i) => {
        if (bucket.max === undefined) {
          ctx.addIssue({
            code: "custom",
            message: `Bucket '${bucket.label}' must have a 'max' — only the last bucket may omit it`,
            path: ["buckets", i, "max"],
          });
        }
      });
    }),
]);

// Fields every visualisation shares: where the data comes from, how it's
// filtered, and how it's paged. The per-type channels are added on top.
const dataSource = z.object({
  id: z.string(),
  title: z.string(),
  extracts: z.array(visualisationExtract).min(1),
  filters: z.array(filter),
  pagination: pagination.nullable(),
});

// ---------------------------------------------------------------------------
// Per-type visualisations — the user picks `type` first, which dictates the
// channels they then fill in.
// ---------------------------------------------------------------------------

export const visualisation = z.discriminatedUnion("type", [
  dataSource.extend({
    type: z.literal("table"),
    columns: z.array(fieldRef).min(1),
    sort: sort.nullable(),
  }),
  dataSource.extend({
    type: z.literal("bar"),
    category: fieldRef,
    value: fieldRef,
    series: fieldRef.optional(),
  }),
  dataSource.extend({
    type: z.literal("line"),
    x: fieldRef,
    y: fieldRef,
    series: fieldRef.optional(),
  }),
  dataSource.extend({
    type: z.literal("area"),
    x: fieldRef,
    y: fieldRef,
    series: fieldRef.optional(),
  }),
  dataSource.extend({
    type: z.literal("scatter"),
    x: fieldRef,
    y: fieldRef,
    series: fieldRef.optional(),
    // A scatter chart returns one row per matched point — with large
    // datasets that's too many to render. `sampleSize`, if set, takes a
    // random sample of this many points instead of every match.
    sampleSize: z.number().int().positive().optional(),
  }),
  dataSource.extend({
    type: z.literal("pie"),
    category: fieldRef,
    value: fieldRef,
  }),
  dataSource.extend({
    type: z.literal("distribution"),
    value: fieldRef,
    binning: binningStrategy.optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type SortDirection = z.infer<typeof sortDirection>;
export type ResolveStrategy = z.infer<typeof resolveStrategy>;
export type VisualisationExtract = z.infer<typeof visualisationExtract>;
export type Aggregation = z.infer<typeof aggregation>;
export type DateBucket = z.infer<typeof dateBucket>;
export type FieldRef = z.infer<typeof fieldRef>;
export type FilterOperator = z.infer<typeof filterOperator>;
export type Filter = z.infer<typeof filter>;
export type Sort = z.infer<typeof sort>;
export type Pagination = z.infer<typeof pagination>;
export type HistogramBucket = z.infer<typeof histogramBucket>;
export type BinningStrategy = z.infer<typeof binningStrategy>;
export type Visualisation = z.infer<typeof visualisation>;
export type VisualisationType = Visualisation["type"];

export function parseVisualisation(input: unknown): Visualisation {
  return visualisation.parse(input);
}
