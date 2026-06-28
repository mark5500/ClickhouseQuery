import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisTickStyle, colorAt, tooltipContentStyle } from "./colors";
import type { Row } from "@/types/visualisation";

const MAX_LEGEND_ENTRIES = 15;

export function ScatterVisualisation({ data }: { data: Row[] }) {
  const hasSeries = data.some((row) => "series" in row);
  const groups = hasSeries ? Array.from(new Set(data.map((row) => row.series))) : [null];
  const xType = typeof data[0]?.x === "number" ? "number" : "category";
  const showLegend = hasSeries && groups.length <= MAX_LEGEND_ENTRIES;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="x" tick={axisTickStyle} type={xType} />
        <YAxis dataKey="y" tick={axisTickStyle} type="number" />
        <Tooltip contentStyle={tooltipContentStyle} cursor={{ strokeDasharray: "3 3" }} />
        {showLegend && <Legend />}
        {groups.map((groupValue, i) => (
          <Scatter
            key={String(groupValue)}
            name={groupValue !== null ? String(groupValue) : "Value"}
            data={hasSeries ? data.filter((row) => row.series === groupValue) : data}
            fill={colorAt(i)}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
