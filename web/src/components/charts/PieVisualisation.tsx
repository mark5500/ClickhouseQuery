import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { colorAt, tooltipContentStyle } from "./colors";
import type { Row } from "@/types/visualisation";

export function PieVisualisation({ data }: { data: Row[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="category" outerRadius={100} label>
          {data.map((_, i) => (
            <Cell key={i} fill={colorAt(i)} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipContentStyle} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
