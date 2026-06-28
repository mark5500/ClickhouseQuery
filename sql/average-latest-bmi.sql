-- Average BMI across all subjects, using each subject's latest BMI record only.
WITH latest_bmi AS (
    SELECT
        subject_id,
        payload,
        submitted_at
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
)
SELECT
    avg(JSONExtractFloat(payload, 'bmi')) AS average_bmi,
    count() AS subject_count
FROM latest_bmi;
