import { createClient } from "@clickhouse/client";
import "dotenv/config";

export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DB ?? "default",
  // `payload` is a native JSON column (still experimental as of ClickHouse 24.8).
  clickhouse_settings: { allow_experimental_json_type: 1 },
});
