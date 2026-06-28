export type Row = Record<string, string | number>;

export type VisualisationType = "table" | "bar" | "pie" | "distribution" | "line" | "area" | "scatter";

export type Column = {
  key: string;
  label?: string;
};

// What the dashboard endpoint returns — just enough to know how to render
// and where to fetch data from. Field-level query details (extracts,
// filters, aggregates) live only on the server; chart types other than
// "table" always use fixed canonical row keys (x/y/category/value/series),
// so no extra metadata is needed for them.
export type DashboardEntry = {
  id: string;
  title: string;
  type: VisualisationType;
  columns?: Column[];
};
