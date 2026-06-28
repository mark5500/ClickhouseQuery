import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisTickStyle, colorAt, tooltipContentStyle } from "./colors";
import type { Row } from "@/types/visualisation";

// The server computes the bucketing. Numeric binning strategies ("auto",
// "fixed-width") return { rangeStart, rangeEnd, count }; "custom" named
// buckets return { category, count } instead.
export function DistributionVisualisation({ data }: { data: Row[] }) {
  const histogram = data.map((row) => ({
    range: "category" in row ? String(row.category) : `${Number(row.rangeStart).toFixed(1)}–${Number(row.rangeEnd).toFixed(1)}`,
    count: Math.round(Number(row.count)),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={histogram}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="range" tick={axisTickStyle} />
        <YAxis tick={axisTickStyle} allowDecimals={false} />
        <Tooltip contentStyle={tooltipContentStyle} />
        <Bar dataKey="count" name="Count" fill={colorAt(0)} radius={4} />
      </BarChart>
    </ResponsiveContainer>
  );
}
