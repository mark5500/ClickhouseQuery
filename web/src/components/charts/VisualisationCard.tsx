import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVisualisationData } from "@/lib/useVisualisationData";
import type { DashboardEntry, Row } from "@/types/visualisation";
import { BarVisualisation } from "./BarVisualisation";
import { ChartErrorBoundary } from "./ChartErrorBoundary";
import { DistributionVisualisation } from "./DistributionVisualisation";
import { LineAreaVisualisation } from "./LineAreaVisualisation";
import { PieVisualisation } from "./PieVisualisation";
import { ScatterVisualisation } from "./ScatterVisualisation";
import { TableVisualisation } from "./TableVisualisation";

const TABLE_PAGE_SIZE = 10;

function renderChart(entry: DashboardEntry, rows: Row[]) {
  switch (entry.type) {
    case "table":
      return <TableVisualisation data={rows} columns={entry.columns ?? rawColumns(rows)} />;
    case "bar":
      return <BarVisualisation data={rows} />;
    case "line":
    case "area":
      return <LineAreaVisualisation data={rows} variant={entry.type} />;
    case "scatter":
      return <ScatterVisualisation data={rows} />;
    case "pie":
      return <PieVisualisation data={rows} />;
    case "distribution":
      return <DistributionVisualisation data={rows} />;
  }
}

function rawColumns(rows: Row[]) {
  return Object.keys(rows[0] ?? {}).map((key) => ({ key }));
}

function TablePagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <div className="mt-3 flex items-center justify-between">
      <p className="text-muted-foreground text-sm">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={end >= total} onClick={() => onChange(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function VisualisationCard({ entry }: { entry: DashboardEntry }) {
  const isTable = entry.type === "table";
  const [offset, setOffset] = useState(0);
  const { rows, total, error } = useVisualisationData(
    entry.id,
    isTable ? { limit: TABLE_PAGE_SIZE, offset } : undefined
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{entry.title}</CardTitle>
        <Badge variant="secondary" className="capitalize">
          {entry.type}
        </Badge>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-destructive text-sm">Failed to load: {error}</p>
        ) : rows === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <ChartErrorBoundary>
            {isTable ? (
              <>
                {renderChart(entry, rows)}
                {total !== null && (
                  <TablePagination offset={offset} limit={TABLE_PAGE_SIZE} total={total} onChange={setOffset} />
                )}
              </>
            ) : (
              <Tabs defaultValue="chart">
                <TabsList>
                  <TabsTrigger value="chart">Chart</TabsTrigger>
                  <TabsTrigger value="data">Data</TabsTrigger>
                </TabsList>
                <TabsContent value="chart">{renderChart(entry, rows)}</TabsContent>
                <TabsContent value="data" className="max-h-[280px] overflow-auto">
                  <TableVisualisation data={rows} columns={rawColumns(rows)} />
                </TabsContent>
              </Tabs>
            )}
          </ChartErrorBoundary>
        )}
      </CardContent>
    </Card>
  );
}
