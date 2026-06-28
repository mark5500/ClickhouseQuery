import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisTickStyle, colorAt, tooltipContentStyle } from "./colors";
import type { Row } from "@/types/visualisation";

const MAX_LEGEND_ENTRIES = 15;

export function LineAreaVisualisation({ data, variant }: { data: Row[]; variant: "line" | "area" }) {
  const hasSeries = data.some((row) => "series" in row);
  const groups = hasSeries ? Array.from(new Set(data.map((row) => row.series))) : [null];
  const Chart = variant === "area" ? AreaChart : LineChart;
  const showLegend = hasSeries && groups.length <= MAX_LEGEND_ENTRIES;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <Chart>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="x" tick={axisTickStyle} allowDuplicatedCategory={false} />
        <YAxis dataKey="y" tick={axisTickStyle} />
        <Tooltip contentStyle={tooltipContentStyle} />
        {showLegend && <Legend />}
        {groups.map((groupValue, i) => {
          const subset = hasSeries ? data.filter((row) => row.series === groupValue) : data;
          const name = groupValue !== null ? String(groupValue) : "Value";
          return variant === "area" ? (
            <Area
              key={String(groupValue)}
              type="monotone"
              data={subset}
              dataKey="y"
              name={name}
              stroke={colorAt(i)}
              fill={colorAt(i)}
              fillOpacity={0.15}
              connectNulls
            />
          ) : (
            <Line
              key={String(groupValue)}
              type="monotone"
              data={subset}
              dataKey="y"
              name={name}
              stroke={colorAt(i)}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          );
        })}
      </Chart>
    </ResponsiveContainer>
  );
}
