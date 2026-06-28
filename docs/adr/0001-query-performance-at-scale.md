# ADR 0001: Query performance lessons at scale

## Status

Accepted

## Context

The dataset grew from a few thousand subjects to tens of thousands, each with
many time-stamped records stored as semi-structured payloads in a single
events-style table (one row per submitted record, grouped by a subject
identifier and an extract/category identifier). As volume grew, a class of
"give me the latest record per subject" queries — the basis of almost every
chart and table in the system — went from comfortably fast to noticeably
slow, and one query pattern relied on for years to express "give me the
latest record per group" turned out to scale far worse than an alternative
that returns identical results.

Along the way an experimental "native JSON" column type was evaluated as a
replacement for storing payloads as opaque strings, and a serious,
silent correctness bug was found and fixed. Both are recorded here because
the *process* of diagnosing them is as reusable as the specific fixes.

This record is intentionally written without naming a specific database
product, language, or library — the lessons apply to any column-oriented
analytical store with a sorted primary index (ClickHouse, Druid, Snowflake's
clustering, BigQuery's clustering, etc.), and to any query layer that
generates SQL on behalf of users.

## Decisions and lessons

### 1. A sorted primary index already gives you most of what a partition would

Splitting a table into partitions (e.g. one partition per category) feels
like the obvious lever to pull when a table gets big: "smaller pieces means
faster scans." In practice, if the table's primary sort key already begins
with the column you'd partition by, the engine can already skip
non-matching data using its sparse index — partitioning the same column on
top adds no query-time benefit, because there was nothing left to prune.

Partitioning still has value, but it's operational, not query-time: it lets
you drop or rebuild one category's data without touching the rest, isolate
background compaction/merge work per category, and apply different
retention rules per partition. Don't reach for partitioning to solve a slow
query unless you've confirmed the *current* sort key isn't already pruning
the same dimension.

**Takeaway:** before partitioning, check what your primary/sort key already
prunes. Partitioning is for operational isolation; a well-chosen sort key is
what makes queries fast.

### 2. "Latest record per group" should be a hash aggregation, not a sort

The natural-looking way to express "one row per subject, the most recent
one" is something like:

```sql
SELECT *
FROM records
ORDER BY subject_id, recorded_at DESC
LIMIT 1 BY subject_id
```

This is correct, but it forces the engine to fully sort every matching row
before it can pick winners. The equivalent, much cheaper formulation is a
grouped aggregation that picks the winning row's columns directly:

```sql
SELECT
  subject_id,
  argMax(value, recorded_at) AS value,
  max(recorded_at)           AS recorded_at
FROM records
GROUP BY subject_id
```

(`argMax(value, key)` — "give me the value of this column from whichever row
has the maximum key" — has equivalents in most analytical engines: window
functions with `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ... DESC) = 1`,
`DISTINCT ON` in Postgres, etc. The principle is the same regardless of the
exact syntax.)

A full sort is asymptotically more expensive than a single-pass hash
aggregation. In this codebase, switching every "latest per subject" query
from the sort-and-limit form to the grouped-aggregation form cut query time
by roughly 3x on its own, before any other change. This was by far the
single highest-leverage fix in the whole investigation — bigger than the
storage-format change described below.

**Takeaway:** if a query's job is "deduplicate to one row per group, keeping
the newest/oldest/extreme value," reach for grouped aggregation first.
Reserve sort-based top-N-per-group for when you genuinely need more than one
row per group, or a full ranking.

### 3. Don't read more of a semi-structured column than you need

Storing flexible, per-category payloads as semi-structured data (whether
that's a JSON-typed column, a string blob parsed at query time, or a
key/value map) is convenient, but it's easy to accidentally read the whole
structure when you only need one or two fields out of it — `SELECT *`,
or any equivalent that materializes the entire payload before extracting
fields.

This matters more, not less, once you adopt a typed/structured
representation for that data (a native JSON or struct column, as opposed to
an opaque string). A typed semi-structured column is often physically
organized so that each field can be a separate sub-column on disk — but only
if the query asks for that field specifically. Asking for the whole object
forces the engine to reconstruct and read every field, which can be *slower*
than parsing a string blob would have been, because the string blob was at
least one undifferentiated chunk while the structured column now does
extra work to assemble all its parts.

The fix is mechanical but easy to forget under deadline pressure: have the
query-generation layer compute, for each source of data, exactly which
fields are actually referenced (by what's selected, filtered, or sorted on)
and project only those — never the whole row or the whole payload.

**Takeaway:** moving to a typed structured column format only pays off if
your queries are rewritten to ask for individual fields, not the whole
object. Measure before/after with realistic queries, not just "is the new
column type technically faster in isolation."

### 4. A literal constant column mixed into a multi-aggregate `GROUP BY` can silently corrupt results

The most serious issue found in this investigation was not a performance
problem — it was correctness. A query selected several aggregate
expressions that all shared the same "pick the row with the max timestamp"
comparator (several `argMax`-style calls, one per field), grouped by
subject, *and* included one harmless-looking literal constant column (a
fixed string identifying which category the query was for — present for
labeling convenience, not used by anything downstream).

That combination — a literal/constant column, alongside multiple aggregates
sharing a comparator argument, under a `GROUP BY` — caused a large
fraction of rows (in this case, on the order of three-quarters) to come
back with one of the aggregated fields silently blanked out. No error was
raised. The query returned a normal-looking result set; only careful manual
auditing against a known total caught the discrepancy.

The fix was simply to drop the unused constant column from the query.
Once removed, results were correct and matched independently-verified
totals in every subsequent test (sequential and concurrent, at full scale).

**Takeaway:** never trust a query's correctness on the basis that it ran
without error and "looks plausible" on a small sample. When a query
combines multiple aggregates over a shared comparator with a `GROUP BY`,
test against a known total at full scale, not a `LIMIT`-bounded preview.
Also: drop columns from a query that aren't actually used — beyond being
dead weight, this investigation is a reminder that an unused column is not
always inert.

### 5. Don't trust the first plausible cause — isolate variables one at a time

When the corruption above was first noticed, it had just appeared
alongside an unrelated, genuinely experimental change (the structured JSON
column type from lesson 3). That timing made "the experimental feature is
buggy" the obvious explanation, especially since a couple of early repro
attempts seemed to "fix themselves" on retry. Acting on that belief, the
experimental feature was rolled back as the safer choice.

The exact same corruption then reproduced — deterministically, on
repeated runs — with the experimental feature fully removed. The real
cause (lesson 4) had nothing to do with it; the two had simply been
introduced in the same change and changed together.

**Takeaway:** correlation in time ("the bug showed up right when we changed
X") is a hypothesis, not a diagnosis. Before committing to a root cause or a
mitigation — especially a costly one like reverting a feature — isolate
each changed variable independently and confirm the bug does or doesn't
follow it. A bug that "self-heals" on retry without a clear mechanism is a
sign you don't yet understand it, not a sign it's gone.

### 6. Experimental engine features need correctness testing proportional to how new they are

Independent of the bug above, adopting an explicitly experimental database
feature (here, a native semi-structured/JSON column type still marked
experimental by its vendor) is a real trade-off, not a free upgrade. Before
trusting it with production data, it was stress-tested with dozens of
runs of the actual complex queries the application generates — first
against a disposable scratch copy of the data, then, after migrating, with
both sequential and concurrent load against the real table, then re-checked
after a manual table-optimization pass. Only after that did the migration
get treated as final.

**Takeaway:** the newer or more experimental a storage feature is, the more
deliberately you should budget for correctness verification before and
after adopting it — and the decision to accept residual risk should be made
explicitly (and ideally by whoever owns that risk), not by default because
nothing went wrong in casual testing.

### 7. For "too many points to plot," sample — don't truncate

When a chart needs one point per entity and there are far more entities
than can usefully be rendered (a scatter plot with tens of thousands of
points, for example), the easy fix is `LIMIT N`. That's wrong: it shows the
first N rows in whatever order the engine happened to produce them, which
is rarely representative and can visibly bias the chart (e.g. all from one
category, or all old records). Asking the engine for a *random* sample of N
rows instead keeps the chart visually representative of the underlying
distribution at a fraction of the data volume.

This only applies when individual data points matter (scatter-style
visualizations). When the chart's purpose is to show an aggregate shape
(a distribution, a trend over time, a breakdown by category), the better
fix is to aggregate server-side — bucket into a histogram, average into
time buckets, group into categories — rather than sending raw points and
hoping the client can cope.

**Takeaway:** match the volume-reduction strategy to what the chart is for.
Point-level charts: random sampling. Shape/aggregate charts: server-side
aggregation. Tables: pagination. Never just truncate to the first N rows.

### 8. Keep a way to run the generated SQL standalone

Throughout this investigation, the single most useful diagnostic tool was
the ability to take the exact SQL a query-generation layer produced for a
real chart and run it directly against the database, outside the
application, with the database's own row/byte-read statistics attached.
That made it possible to compare two table layouts on identical queries, to
binary-search which clause caused a behavior change, and ultimately to spot
the corruption bug by comparing a generated query's output against an
independently-computed total.

**Takeaway:** if a system generates queries on the user's behalf, invest
early in a way to export and re-run those exact queries by hand. It pays
for itself the first time something needs root-causing.

## Consequences

- "Latest/earliest record per group" queries in this codebase now use
  grouped aggregation, not sort-and-limit, and this should be the default
  pattern for any future query of that shape.
- Query generation projects only the fields a given chart actually needs,
  never a whole row or payload object.
- The experimental structured-payload column type is in active use, backed
  by the stress-testing process in lesson 6, which should be repeated for
  any future schema change to that column.
- A literal/constant column must never be added to a query that also
  contains multiple aggregates sharing a comparator under `GROUP BY`; if a
  label like that is needed, attach it after aggregation (e.g. in the
  application layer) rather than inside the grouped query.
- Point-level charts use random sampling; aggregate charts use server-side
  aggregation; tables are paginated.
- The ability to export and run generated SQL standalone is treated as a
  permanent diagnostic tool, not a one-off spike artifact.
