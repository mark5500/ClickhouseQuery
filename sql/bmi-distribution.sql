-- BMI Distribution
-- Generated from visualisations.ts (id: "bmi-distribution") by src/sql-builder.ts.
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
  )
SELECT
  multiIf(bmi.`bmi` < 18.5, 'Underweight', bmi.`bmi` < 25, 'Normal', bmi.`bmi` < 30, 'Overweight', 'Obese') AS `category`,
  toFloat64(count()) AS `count`
FROM bmi
GROUP BY `category`, multiIf(bmi.`bmi` < 18.5, 0, bmi.`bmi` < 25, 1, bmi.`bmi` < 30, 2, 3)
ORDER BY multiIf(bmi.`bmi` < 18.5, 0, bmi.`bmi` < 25, 1, bmi.`bmi` < 30, 2, 3)
SETTINGS allow_experimental_json_type = 1

