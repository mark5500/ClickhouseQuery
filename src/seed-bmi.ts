import { randomUUID } from "node:crypto";
import { clickhouse } from "./client.js";
import { ensureDataPointsTable, randomSubmittedAt } from "./seed-helpers.js";
import { subjects } from "./subjects.js";
import { bmiDataExtract, type DataPoint, type ExternalBmiRecord } from "./types.js";

const RECORDS_PER_SUBJECT_MIN = 10;
const RECORDS_PER_SUBJECT_MAX = 40;

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomInRange(min, max + 1));
}

function generateExternalBmiRecord(subjectId: string): ExternalBmiRecord {
  const heightCm = randomInRange(150, 200);
  const weightKg = randomInRange(45, 120);
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);

  return {
    dataExtractId: bmiDataExtract.id,
    subjectId,
    submittedAt: randomSubmittedAt(),
    dataPoint: {
      height: Math.round(heightCm * 10) / 10,
      weight: Math.round(weightKg * 10) / 10,
      bmi: Math.round(bmi * 10) / 10,
    },
  };
}

function toDataPoint(record: ExternalBmiRecord): DataPoint {
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
    Array.from({ length: randomInt(RECORDS_PER_SUBJECT_MIN, RECORDS_PER_SUBJECT_MAX) }, () =>
      toDataPoint(generateExternalBmiRecord(subject.id))
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

  console.log(`Inserted ${dataPoints.length} BMI data points for ${subjects.length} subjects.`);

  await clickhouse.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
