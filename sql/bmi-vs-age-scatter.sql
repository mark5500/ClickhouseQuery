-- BMI vs. age for each subject (latest BMI and demographics record).
-- One row per subject: good for a scatter plot (age on x, bmi on y).
WITH latest_bmi AS (
    SELECT
        subject_id,
        JSONExtractFloat(payload, 'bmi') AS bmi
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
),
latest_demographics AS (
    SELECT
        subject_id,
        JSONExtractString(payload, 'sex') AS sex,
        JSONExtractString(payload, 'dateOfBirth')::Date AS date_of_birth
    FROM data_points
    WHERE data_extract_id = 'demographics'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
)
SELECT
    b.subject_id AS subject_id,
    dateDiff('year', d.date_of_birth, today()) AS age,
    d.sex AS sex,
    b.bmi AS bmi
FROM latest_bmi AS b
INNER JOIN latest_demographics AS d ON b.subject_id = d.subject_id
ORDER BY age;
