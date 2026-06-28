-- Average BMI Trend by Sex
-- Generated from visualisations.ts (id: "bmi-trend") by src/sql-builder.ts.
-- Regenerate with: npx tsx src/write-sql-files.ts

WITH
  bmi AS (
    SELECT
      subject_id,
      data_points.id AS `id`,
      data_points.submitted_at AS `submitted_at`,
      data_points.payload.`bmi`::Float64 AS `bmi`
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY submitted_at ASC
  ),
  demo AS (
    SELECT
      subject_id,
      argMax(data_points.id, data_points.submitted_at) AS `id`,
      max(data_points.submitted_at) AS `submitted_at`,
      argMax(data_points.payload.`sex`::String, data_points.submitted_at) AS `sex`
    FROM data_points
    WHERE data_extract_id = 'demographics'
    GROUP BY subject_id
  )
SELECT
  demo.`sex` AS `series`,
  toStartOfMonth(bmi.`submitted_at`) AS `x`,
  avg(bmi.`bmi`) AS `y`
FROM bmi
INNER JOIN demo ON bmi.subject_id = demo.subject_id
GROUP BY demo.`sex`, toStartOfMonth(bmi.`submitted_at`)
ORDER BY toStartOfMonth(bmi.`submitted_at`) ASC
SETTINGS allow_experimental_json_type = 1
