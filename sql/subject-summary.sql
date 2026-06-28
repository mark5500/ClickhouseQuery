-- Subject Summary
-- Generated from visualisations.ts (id: "subject-summary") by src/sql-builder.ts.
-- Regenerate with: npx tsx src/write-sql-files.ts

WITH
  demo AS (
    SELECT
      subject_id,
      argMax(data_points.id, data_points.submitted_at) AS `id`,
      max(data_points.submitted_at) AS `submitted_at`,
      argMax(data_points.payload.`givenNames`::String, data_points.submitted_at) AS `givenNames`,
      argMax(data_points.payload.`familyName`::String, data_points.submitted_at) AS `familyName`,
      argMax(data_points.payload.`sex`::String, data_points.submitted_at) AS `sex`
    FROM data_points
    WHERE data_extract_id = 'demographics'
    GROUP BY subject_id
  ),
  bmi AS (
    SELECT
      subject_id,
      argMax(data_points.id, data_points.submitted_at) AS `id`,
      max(data_points.submitted_at) AS `submitted_at`,
      argMax(data_points.payload.`bmi`::Float64, data_points.submitted_at) AS `bmi`
    FROM data_points
    WHERE data_extract_id = 'bmi'
    GROUP BY subject_id
  )
SELECT
  demo.`givenNames` AS `givenNames`,
  demo.`familyName` AS `familyName`,
  demo.`sex` AS `sex`,
  bmi.`bmi` AS `bmi`
FROM demo
INNER JOIN bmi ON demo.subject_id = bmi.subject_id
ORDER BY demo.`familyName` ASC
LIMIT 10 OFFSET 0
SETTINGS allow_experimental_json_type = 1
