import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { clickhouse } from "./client.js";
import { buildCountSql, buildSql, columnAlias, type ExtractRegistry } from "./sql-builder.js";
import { bloodPressureDataExtract, bmiDataExtract, demographicsDataExtract } from "./types.js";
import { visualisations } from "./visualisations.js";
import type { Visualisation } from "./visualisation-schema.js";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_PAGE_SIZE = 100;

const registry: ExtractRegistry = {
  bmi: bmiDataExtract,
  demographics: demographicsDataExtract,
  "blood-pressure": bloodPressureDataExtract,
};

const visualisationsById = new Map(visualisations.map((v) => [v.id, v]));

// What a client needs to render a chart: its identity, type, and — for
// tables only — the column keys/labels to read from the row data. Every
// other chart type uses fixed canonical keys (x/y/category/value/series),
// so no field-level metadata needs to leave the server for those.
function toDashboardEntry(viz: Visualisation) {
  const base = { id: viz.id, title: viz.title, type: viz.type };
  if (viz.type === "table") {
    return {
      ...base,
      columns: viz.columns.map((col) => ({
        key: columnAlias(col),
        label: col.label ?? col.field,
      })),
    };
  }
  return base;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleDashboard(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { visualisations: visualisations.map(toDashboardEntry) });
}

async function handleVisualisationData(
  id: string,
  searchParams: URLSearchParams,
  res: ServerResponse
): Promise<void> {
  const viz = visualisationsById.get(id);
  if (!viz) {
    sendJson(res, 404, { error: `No visualisation with id '${id}'` });
    return;
  }

  // For tables, the client can page through results — clamp limit so a
  // client can't request an unbounded page.
  const paged: Visualisation =
    viz.type === "table"
      ? {
          ...viz,
          pagination: {
            limit: Math.min(
              Number(searchParams.get("limit") ?? viz.pagination?.limit ?? 25),
              MAX_PAGE_SIZE
            ),
            offset: Number(searchParams.get("offset") ?? viz.pagination?.offset ?? 0),
          },
        }
      : viz;

  const sql = buildSql(paged, registry);
  const resultSetPromise = clickhouse.query({ query: sql, format: "JSONEachRow" }).then((rs) => rs.json());

  if (viz.type !== "table") {
    sendJson(res, 200, { rows: await resultSetPromise });
    return;
  }

  const countSql = buildCountSql(viz, registry);
  const countPromise = clickhouse
    .query({ query: countSql, format: "JSONEachRow" })
    .then((rs) => rs.json() as Promise<{ total: number }[]>);

  const [rows, countRows] = await Promise.all([resultSetPromise, countPromise]);
  sendJson(res, 200, { rows, total: countRows[0]?.total ?? 0 });
}

const dataRoute = /^\/api\/visualisations\/([^/]+)\/data$/;

const server = createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET" || !req.url) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/dashboard") {
    handleDashboard(req, res).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
    return;
  }

  const dataMatch = url.pathname.match(dataRoute);
  if (dataMatch) {
    handleVisualisationData(decodeURIComponent(dataMatch[1]), url.searchParams, res).catch((err) => {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
