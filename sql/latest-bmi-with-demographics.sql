-- Latest BMI record per subject, joined with their latest demographics record.
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
    b.subject_id AS subject_id,
    JSONExtractString(d.payload, 'givenNames') AS given_names,
    JSONExtractString(d.payload, 'familyName') AS family_name,
    JSONExtractString(d.payload, 'sex') AS sex,
    JSONExtractString(d.payload, 'dateOfBirth') AS date_of_birth,
    JSONExtractFloat(b.payload, 'height') AS height,
    JSONExtractFloat(b.payload, 'weight') AS weight,
    JSONExtractFloat(b.payload, 'bmi') AS bmi,
    b.submitted_at AS bmi_submitted_at,
    d.submitted_at AS demographics_submitted_at
FROM latest_bmi AS b
INNER JOIN latest_demographics AS d ON b.subject_id = d.subject_id
ORDER BY b.subject_id;
