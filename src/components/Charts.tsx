import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatNumber } from '../lib/format'

type TimelinePoint = { day: string; count: number }
type Sentiment = { positive: number; neutral: number; negative: number }

function shortDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T00:00:00`))
}

export function VolumeChart({ data }: { data: TimelinePoint[] }) {
  if (!data.length) {
    return <div className="chart-empty">Belum cukup data untuk membuat grafik.</div>
  }

  return (
    <div className="chart-canvas" aria-label="Grafik volume percakapan per hari">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 2, left: -22 }}>
          <defs>
            <linearGradient id="volume-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <XAxis
            dataKey="day"
            tickFormatter={shortDate}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)' }}
            content={({ active, payload, label }) => active && payload?.length ? (
              <div className="chart-tooltip">
                <span>{shortDate(String(label))}</span>
                <strong>{formatNumber(Number(payload[0].value))} tweet</strong>
              </div>
            ) : null}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--accent)"
            strokeWidth={2.5}
            fill="url(#volume-fill)"
            activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SentimentChart({ values }: { values: Sentiment }) {
  const total = values.positive + values.neutral + values.negative
  const data = [
    { key: 'positive', label: 'Positif', value: values.positive, color: 'var(--positive)' },
    { key: 'neutral', label: 'Netral', value: values.neutral, color: 'var(--neutral)' },
    { key: 'negative', label: 'Negatif', value: values.negative, color: 'var(--negative)' },
  ]

  return (
    <div className="sentiment-wrap">
      <div className="donut-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={total ? data : [{ value: 1, color: 'var(--line-strong)' }]}
              dataKey="value"
              innerRadius="72%"
              outerRadius="96%"
              paddingAngle={total ? 2 : 0}
              stroke="none"
            >
              {(total ? data : [{ color: 'var(--line-strong)' }]).map((item, index) => (
                <Cell key={index} fill={item.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-label"><strong>{formatNumber(total)}</strong><span>tweet</span></div>
      </div>
      <div className="sentiment-list">
        {data.map((item) => {
          const percent = total ? Math.round(item.value / total * 100) : 0
          return (
            <div key={item.key}>
              <span><i style={{ background: item.color }} />{item.label}</span>
              <strong>{percent}%</strong>
            </div>
          )
        })}
      </div>
    </div>
  )
}
