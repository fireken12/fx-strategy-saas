import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

interface StrategyItem {
  id: string;
  name: string;
  color: string;
}

interface DataPoint {
  t: number;
  date?: string;
  [key: string]: number | string | undefined;
}

interface Props {
  data: DataPoint[];
  items: StrategyItem[];
  highlight?: { date: string; color: string } | null;
}

// X軸の日付を間引いて表示
function tickFormatter(value: string) {
  if (!value) return "";
  // "2024-01-15" → "1/15"
  const parts = value.split("-");
  if (parts.length < 3) return value;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

export function StrategyCompareEquityChart({ data, items, highlight }: Props) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ left: 10, right: 10, bottom: 20 }}>
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          interval={Math.floor(data.length / 10)}
          angle={-35}
          textAnchor="end"
          tick={{ fontSize: 11 }}
          height={50}
        />
        <YAxis
          label={{ value: "エクイティ (pips)", angle: -90, position: "insideLeft", offset: 10 }}
          tick={{ fontSize: 11 }}
          width={70}
        />
        <Tooltip
          labelFormatter={(label) => `日付: ${label}`}
          formatter={(value: number) => [`${value.toFixed(1)} pips`]}
        />
        <Legend />
        {highlight && (
          <ReferenceLine x={highlight.date} stroke={highlight.color} strokeWidth={2} strokeDasharray="4 2" label={{ value: "▲", fill: highlight.color, fontSize: 14 }} />
        )}
        {items.map((s) => (
          <Line key={s.id} type="monotone" dataKey={s.name} stroke={s.color} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StrategyCompareDrawdownChart({ data, items }: Props) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ left: 10, right: 10, bottom: 20 }}>
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          interval={Math.floor(data.length / 10)}
          angle={-35}
          textAnchor="end"
          tick={{ fontSize: 11 }}
          height={50}
        />
        <YAxis
          label={{ value: "ドローダウン (pips)", angle: -90, position: "insideLeft", offset: 10 }}
          tick={{ fontSize: 11 }}
          width={70}
        />
        <Tooltip
          labelFormatter={(label) => `日付: ${label}`}
          formatter={(value: number) => [`${value.toFixed(1)} pips`]}
        />
        <Legend />
        {items.map((s) => (
          <Line key={s.id} type="monotone" dataKey={`${s.name}_dd`} stroke={s.color} dot={false} strokeWidth={2} strokeDasharray="4 2" />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
