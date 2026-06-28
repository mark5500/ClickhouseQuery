-- Average BMI by sex, using each subject's latest BMI and demographics record.
WITH latest_bmi AS (
    SELECT
        subject_id,
        payload,
        submitted_at
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
),
latest_demographics AS (
    SELECT
        subject_id,
        payload,
        submitted_at
    FROM data_points
    WHERE data_extract_id = 'demographics'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
)
SELECT
    JSONExtractString(d.payload, 'sex') AS sex,
    avg(JSONExtractFloat(b.payload, 'bmi')) AS average_bmi,
    count() AS subject_count
FROM latest_bmi AS b
INNER JOIN latest_demographics AS d ON b.subject_id = d.subject_id
GROUP BY sex
ORDER BY sex;
