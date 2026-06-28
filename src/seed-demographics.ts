import { randomUUID } from "node:crypto";
import { clickhouse } from "./client.js";
import { ensureDataPointsTable, randomSubmittedAt } from "./seed-helpers.js";
import { subjects } from "./subjects.js";
import { demographicsDataExtract, type DataPoint, type ExternalDemographicsRecord } from "./types.js";

// Most subjects have a single demographics submission, but some have had
// their record updated and resubmitted one or more times.
const RESUBMISSION_CHANCE = 0.2;
const MAX_SUBMISSIONS_PER_SUBJECT = 1;

const FEMALE_GIVEN_NAMES = [
  "Olivia", "Emma", "Ava", "Sophia", "Isabella", "Mia", "Amelia", "Harper", "Evelyn", "Charlotte",
  "Abigail", "Emily", "Elizabeth", "Mila", "Ella", "Avery", "Sofia", "Camila", "Aria", "Scarlett",
  "Victoria", "Madison", "Luna", "Grace", "Chloe", "Penelope", "Layla", "Riley", "Zoey", "Nora",
  "Lily", "Eleanor", "Hannah", "Lillian", "Addison", "Aubrey", "Ellie", "Stella", "Natalie", "Zoe",
  "Leah", "Hazel", "Violet", "Aurora", "Savannah", "Audrey", "Brooklyn", "Bella", "Claire", "Skylar",
  "Paisley", "Everly", "Anna", "Caroline", "Nova", "Genesis", "Emilia", "Kennedy", "Samantha", "Maya",
  "Willow", "Kinsley", "Naomi", "Aaliyah", "Elena", "Sarah", "Ariana", "Allison", "Gabriella", "Alice",
  "Madelyn", "Cora", "Ruby", "Eva", "Serenity", "Autumn", "Adeline", "Hailey", "Gianna", "Valentina",
  "Isla", "Eliana", "Quinn", "Nevaeh", "Ivy", "Sadie", "Piper", "Lydia", "Alexandra", "Josephine",
  "Emery", "Julia", "Delilah", "Arianna", "Vivian", "Kaylee", "Sophie", "Brielle", "Madeline", "Peyton",
];
const MALE_GIVEN_NAMES = [
  "Liam", "Noah", "Oliver", "Elijah", "James", "William", "Benjamin", "Lucas", "Henry", "Theodore",
  "Jack", "Levi", "Alexander", "Jackson", "Mateo", "Daniel", "Michael", "Mason", "Sebastian", "Ethan",
  "Logan", "Owen", "Samuel", "Jacob", "Asher", "Aiden", "John", "Joseph", "Wyatt", "David",
  "Leo", "Luke", "Julian", "Hudson", "Grayson", "Matthew", "Ezra", "Gabriel", "Carter", "Isaac",
  "Jayden", "Luca", "Anthony", "Dylan", "Lincoln", "Thomas", "Maverick", "Elias", "Josiah", "Charles",
  "Caleb", "Christopher", "Ezekiel", "Miles", "Jaxon", "Isaiah", "Andrew", "Joshua", "Nathan", "Nolan",
  "Adrian", "Cameron", "Santiago", "Eli", "Aaron", "Ryan", "Angel", "Cooper", "Waylon", "Easton",
  "Kai", "Christian", "Landon", "Colton", "Roman", "Axel", "Brooks", "Jonathan", "Robert", "Jameson",
  "Ian", "Everett", "Greyson", "Wesley", "Jeremiah", "Hunter", "Leonardo", "Jordan", "Jose", "Bennett",
  "Silas", "Nicholas", "Parker", "Beau", "Weston", "Austin", "Connor", "Damian", "Xavier", "Tyler",
];
const FAMILY_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
  "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
  "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes",
  "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper",
  "Peterson", "Bailey", "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox", "Ward", "Richardson",
  "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza", "Ruiz", "Hughes",
  "Price", "Alvarez", "Castillo", "Sanders", "Patel", "Myers", "Long", "Ross", "Foster", "Jimenez",
];

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomDateOfBirth(): string {
  const start = new Date("1950-01-01").getTime();
  const end = new Date("2010-12-31").getTime();
  const date = new Date(start + Math.random() * (end - start));
  return date.toISOString().slice(0, 10);
}

function generateExternalDemographicsRecord(subjectId: string): ExternalDemographicsRecord {
  const sex: "male" | "female" = Math.random() < 0.5 ? "female" : "male";
  const givenNames = randomFrom(sex === "female" ? FEMALE_GIVEN_NAMES : MALE_GIVEN_NAMES);

  return {
    dataExtractId: demographicsDataExtract.id,
    subjectId,
    submittedAt: randomSubmittedAt(),
    dataPoint: {
      givenNames,
      familyName: randomFrom(FAMILY_NAMES),
      sex,
      dateOfBirth: randomDateOfBirth(),
    },
  };
}

function toDataPoint(record: ExternalDemographicsRecord): DataPoint {
  return {
    id: randomUUID(),
    dataExtractId: record.dataExtractId,
    subjectId: record.subjectId,
    submittedAt: record.submittedAt,
    payload: record.dataPoint,
  };
}

function submissionCountFor(): number {
  if (Math.random() >= RESUBMISSION_CHANCE) {
    return 1;
  }
  return Math.ceil(Math.random() * (MAX_SUBMISSIONS_PER_SUBJECT - 1)) + 1;
}

async function main() {
  await ensureDataPointsTable(clickhouse);

  const dataPoints: DataPoint[] = subjects.flatMap((subject) =>
    Array.from({ length: submissionCountFor() }, () =>
      toDataPoint(generateExternalDemographicsRecord(subject.id))
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

  console.log(`Inserted ${dataPoints.length} demographics data points for ${subjects.length} subjects.`);

  await clickhouse.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
