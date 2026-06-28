import { clickhouse } from "./client.js";
import { buildSql, type ExtractRegistry } from "./sql-builder.js";
import { bloodPressureDataExtract, bmiDataExtract, demographicsDataExtract } from "./types.js";
import { visualisations } from "./visualisations.js";

const registry: ExtractRegistry = {
  bmi: bmiDataExtract,
  demographics: demographicsDataExtract,
  "blood-pressure": bloodPressureDataExtract,
};

const RUNS = 4; // 1 warm-up + 3 measured

async function timeQuery(sql: string): Promise<{ ms: number; rowsRead: number; bytesRead: number }> {
  const start = performance.now();
  const rs = await clickhouse.query({
    query: sql,
    format: "JSON",
    clickhouse_settings: { max_threads: 4 },
  });
  const body = (await rs.json()) as { statistics?: { rows_read?: number; bytes_read?: number } };
  const ms = performance.now() - start;
  return {
    ms,
    rowsRead: body.statistics?.rows_read ?? 0,
    bytesRead: body.statistics?.bytes_read ?? 0,
  };
}

async function main() {
  console.log(`Benchmarking ${visualisations.length} visualisations (${RUNS - 1} measured runs each)\n`);
  console.log(
    "visualisation".padEnd(26) +
      "median ms".padStart(11) +
      "rows read".padStart(13) +
      "bytes read".padStart(14)
  );
  console.log("-".repeat(64));

  // Benchmark against the v2 table (native JSON + partitioned) without
  // touching the builder's hardcoded table name.
  const targetTable = process.env.BENCH_TABLE ?? "data_points";

  for (const viz of visualisations) {
    const sql = buildSql(viz, registry).replace(/FROM data_points$/gm, `FROM ${targetTable}`);
    const times: number[] = [];
    let rowsRead = 0;
    let bytesRead = 0;

    for (let i = 0; i < RUNS; i++) {
      const r = await timeQuery(sql);
      if (i > 0) times.push(r.ms); // drop warm-up
      rowsRead = r.rowsRead;
      bytesRead = r.bytesRead;
    }

    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(
      viz.id.padEnd(26) +
        median.toFixed(0).padStart(11) +
        rowsRead.toLocaleString().padStart(13) +
        `${(bytesRead / 1e6).toFixed(1)} MB`.padStart(14)
    );
  }

  await clickhouse.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
