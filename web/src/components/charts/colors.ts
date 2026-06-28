export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function colorAt(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export const tooltipContentStyle = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  fontSize: 13,
};

export const axisTickStyle = { fill: "var(--muted-foreground)", fontSize: 12 };

