-- Subjects by Sex
-- Generated from visualisations.ts (id: "sex-breakdown") by src/sql-builder.ts.
-- Regenerate with: npx tsx src/write-sql-files.ts

WITH
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
  demo.`sex` AS `category`,
  toFloat64(count(demo.`subject_id`)) AS `value`
FROM demo
GROUP BY demo.`sex`
SETTINGS allow_experimental_json_type = 1
