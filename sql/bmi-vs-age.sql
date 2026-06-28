-- BMI vs Date of Birth
-- Generated from visualisations.ts (id: "bmi-vs-age") by src/sql-builder.ts.
-- Regenerate with: npx tsx src/write-sql-files.ts

WITH
  bmi AS (
    SELECT
      subject_id,
      argMax(data_points.id, data_points.submitted_at) AS `id`,
      max(data_points.submitted_at) AS `submitted_at`,
      argMax(data_points.payload.`bmi`::Float64, data_points.submitted_at) AS `bmi`
    FROM data_points
    WHERE data_extract_id = 'bmi'
    GROUP BY subject_id
  ),
  demo AS (
    SELECT
      subject_id,
      argMax(data_points.id, data_points.submitted_at) AS `id`,
      max(data_points.submitted_at) AS `submitted_at`,
      argMax(data_points.payload.`dateOfBirth`::String, data_points.submitted_at) AS `dateOfBirth`,
      argMax(data_points.payload.`sex`::String, data_points.submitted_at) AS `sex`
    FROM data_points
    WHERE data_extract_id = 'demographics'
    GROUP BY subject_id
  )
SELECT
  demo.`sex` AS `series`,
  demo.`dateOfBirth` AS `x`,
  bmi.`bmi` AS `y`
FROM bmi
INNER JOIN demo ON bmi.subject_id = demo.subject_id
ORDER BY rand()
LIMIT 50
SETTINGS allow_experimental_json_type = 1
