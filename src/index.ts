import { clickhouse } from "./client.js";

async function main() {
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS events (
        id UInt64,
        name String,
        created_at DateTime
      ) ENGINE = MergeTree()
      ORDER BY id
    `,
  });

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  await clickhouse.insert({
    table: "events",
    values: [{ id: 1, name: "signup", created_at: now }],
    format: "JSONEachRow",
  });

  const resultSet = await clickhouse.query({
    query: "SELECT * FROM events ORDER BY id",
    format: "JSONEachRow",
  });

  const rows = await resultSet.json();
  console.log(rows);

  await clickhouse.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});