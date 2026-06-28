-- Systolic vs Diastolic
-- Generated from visualisations.ts (id: "systolic-vs-diastolic") by src/sql-builder.ts.
-- Regenerate with: npx tsx src/write-sql-files.ts

WITH
  bp AS (
    SELECT
      subject_id,
      argMax(data_points.id, data_points.submitted_at) AS `id`,
      max(data_points.submitted_at) AS `submitted_at`,
      argMax(data_points.payload.`diastolic`::Float64, data_points.submitted_at) AS `diastolic`,
      argMax(data_points.payload.`systolic`::Float64, data_points.submitted_at) AS `systolic`
    FROM data_points
    WHERE data_extract_id = 'blood-pressure'
    GROUP BY subject_id
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
  bp.`diastolic` AS `x`,
  bp.`systolic` AS `y`
FROM bp
INNER JOIN demo ON bp.subject_id = demo.subject_id
ORDER BY rand()
LIMIT 50
SETTINGS allow_experimental_json_type = 1
