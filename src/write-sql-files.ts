import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCountSql, buildSql, type ExtractRegistry } from "./sql-builder.js";
import { bloodPressureDataExtract, bmiDataExtract, demographicsDataExtract } from "./types.js";
import { visualisations } from "./visualisations.js";

const registry: ExtractRegistry = {
  bmi: bmiDataExtract,
  demographics: demographicsDataExtract,
  "blood-pressure": bloodPressureDataExtract,
};

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlDir = join(projectRoot, "sql");
mkdirSync(sqlDir, { recursive: true });

// `payload` is a native JSON column, still experimental as of ClickHouse
// 24.8 — this setting lets these files run standalone (clickhouse-client,
// curl, etc.) without needing the flag passed separately.
const settingsClause = "\nSETTINGS allow_experimental_json_type = 1\n";

for (const viz of visualisations) {
  const header = `-- ${viz.title}\n-- Generated from visualisations.ts (id: "${viz.id}") by src/sql-builder.ts.\n-- Regenerate with: npx tsx src/write-sql-files.ts\n\n`;
  writeFileSync(join(sqlDir, `${viz.id}.sql`), header + buildSql(viz, registry) + settingsClause);
  console.log(`wrote sql/${viz.id}.sql`);

  if (viz.type === "table") {
    const countHeader = `-- Row count for "${viz.title}" (id: "${viz.id}"), ignoring select/limit.\n-- Used by the API to paginate. Regenerate with: npx tsx src/write-sql-files.ts\n\n`;
    writeFileSync(join(sqlDir, `${viz.id}-count.sql`), countHeader + buildCountSql(viz, registry) + settingsClause);
    console.log(`wrote sql/${viz.id}-count.sql`);
  }
}
