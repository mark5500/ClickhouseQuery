import type { ClickHouseClient } from "@clickhouse/client";

export async function ensureDataPointsTable(clickhouse: ClickHouseClient): Promise<void> {
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS data_points (
        id String,
        data_extract_id String,
        subject_id String,
        submitted_at DateTime,
        payload String
      ) ENGINE = MergeTree()
      ORDER BY (data_extract_id, subject_id)
    `,
  });
}

function toClickHouseDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function randomSubmittedAt(daysAgoMax = 365): string {
  const now = Date.now();
  const offsetMs = Math.random() * daysAgoMax * 24 * 60 * 60 * 1000;
  return toClickHouseDateTime(new Date(now - offsetMs));
}
