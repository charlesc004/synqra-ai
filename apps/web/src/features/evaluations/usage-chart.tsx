"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
export default function UsageChart({
  days,
}: {
  days: { date: string; requests: number; latency_ms: number }[];
}) {
  return (
    <div className="usage-chart">
      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={days}>
          <defs>
            <linearGradient id="usage-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#d4d4d4" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#d4d4d4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 4"
            vertical={false}
            stroke="#333333"
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#a3a3a3" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#a3a3a3" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "#252525",
              border: "1px solid #444",
              borderRadius: 12,
              color: "#eee",
            }}
          />
          <Area
            type="monotone"
            dataKey="requests"
            name="AI requests"
            stroke="#d4d4d4"
            strokeWidth={2}
            fill="url(#usage-gradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
