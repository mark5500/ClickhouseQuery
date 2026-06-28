-- Full BMI history per subject, ordered chronologically.
-- Good for a multi-line chart (x: submitted_at, y: bmi, one line per subject_id).
SELECT
    subject_id,
    submitted_at,
    JSONExtractFloat(payload, 'bmi') AS bmi
FROM data_points
WHERE data_extract_id = 'bmi'
ORDER BY subject_id, submitted_at;
