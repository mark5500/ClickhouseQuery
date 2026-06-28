-- BMI distribution across subjects (latest BMI record only), bucketed into
-- standard WHO categories. Good for a bar chart.
WITH latest_bmi AS (
    SELECT
        subject_id,
        JSONExtractFloat(payload, 'bmi') AS bmi
    FROM data_points
    WHERE data_extract_id = 'bmi'
    ORDER BY subject_id, submitted_at DESC
    LIMIT 1 BY subject_id
)
SELECT
    multiIf(
        bmi < 18.5, 'Underweight (<18.5)',
        bmi < 25, 'Normal (18.5-24.9)',
        bmi < 30, 'Overweight (25-29.9)',
        'Obese (30+)'
    ) AS bmi_category,
    count() AS subject_count
FROM latest_bmi
GROUP BY bmi_category
ORDER BY min(bmi);
