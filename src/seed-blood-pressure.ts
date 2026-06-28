import { randomUUID } from "node:crypto";
import { clickhouse } from "./client.js";
import { ensureDataPointsTable, randomSubmittedAt } from "./seed-helpers.js";
import { subjects } from "./subjects.js";
import { bloodPressureDataExtract, type DataPoint, type ExternalBloodPressureRecord } from "./types.js";

const READINGS_PER_SUBJECT_MIN = 1;
const READINGS_PER_SUBJECT_MAX = 40;

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomInRange(min, max + 1));
}

function generateExternalBloodPressureRecord(subjectId: string): ExternalBloodPressureRecord {
  // Systolic in a broad clinical range; diastolic correlated and always lower.
  const systolic = randomInRange(95, 175);
  const diastolic = Math.min(systolic - 25, randomInRange(60, 110));
  const pulse = randomInRange(55, 100);

  return {
    dataExtractId: bloodPressureDataExtract.id,
    subjectId,
    submittedAt: randomSubmittedAt(),
    dataPoint: {
      systolic: Math.round(systolic),
      diastolic: Math.round(diastolic),
      pulse: Math.round(pulse),
    },
  };
}

function toDataPoint(record: ExternalBloodPressureRecord): DataPoint {
  return {
    id: randomUUID(),
    dataExtractId: record.dataExtractId,
    subjectId: record.subjectId,
    submittedAt: record.submittedAt,
    payload: record.dataPoint,
  };
}

async function main() {
  await ensureDataPointsTable(clickhouse);

  const dataPoints: DataPoint[] = subjects.flatMap((subject) =>
    Array.from({ length: randomInt(READINGS_PER_SUBJECT_MIN, READINGS_PER_SUBJECT_MAX) }, () =>
      toDataPoint(generateExternalBloodPressureRecord(subject.id))
    )
  );

  await clickhouse.insert({
    table: "data_points",
    values: dataPoints.map((dp) => ({
      id: dp.id,
      data_extract_id: dp.dataExtractId,
      subject_id: dp.subjectId,
      submitted_at: dp.submittedAt,
      payload: dp.payload,
    })),
    format: "JSONEachRow",
  });

  console.log(`Inserted ${dataPoints.length} blood pressure data points for ${subjects.length} subjects.`);

  await clickhouse.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
