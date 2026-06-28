import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisTickStyle, colorAt, tooltipContentStyle } from "./colors";
import type { Row } from "@/types/visualisation";

// `series`, if present in the rows, pivots long-format rows (one row per
// category+series pair) into one row per category with each series value as
// its own bar.
function pivotBySeries(data: Row[]) {
  const seriesValues = Array.from(new Set(data.map((row) => String(row.series))));
  const byCategory = new Map<string | number, Row>();

  for (const row of data) {
    const existing = byCategory.get(row.category) ?? { category: row.category };
    existing[String(row.series)] = row.value;
    byCategory.set(row.category, existing);
  }

  return { rows: Array.from(byCategory.values()), seriesValues };
}

export function BarVisualisation({ data }: { data: Row[] }) {
  const hasSeries = data.some((row) => "series" in row);
  const { rows, bars } = hasSeries
    ? (() => {
        const { rows, seriesValues } = pivotBySeries(data);
        return { rows, bars: seriesValues.map((v) => ({ key: v, label: v })) };
      })()
    : { rows: data, bars: [{ key: "value", label: "Value" }] };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="category" tick={axisTickStyle} />
        <YAxis tick={axisTickStyle} />
        <Tooltip contentStyle={tooltipContentStyle} />
        {bars.length > 1 && <Legend />}
        {bars.map((bar, i) => (
          <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={colorAt(i)} radius={4} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
