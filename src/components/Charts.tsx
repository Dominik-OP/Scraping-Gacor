import { formatNumber } from '../lib/format'

type Sentiment = { positive: number; neutral: number; negative: number }

export function SentimentChart({ values }: { values: Sentiment }) {
  const total = values.positive + values.neutral + values.negative
  const data = [
    { key: 'positive', label: 'Positive', value: values.positive },
    { key: 'neutral', label: 'Neutral', value: values.neutral },
    { key: 'negative', label: 'Negative', value: values.negative },
  ]
  return <div className="sentiment-wrap">
    <div className="sentiment-track" aria-hidden>{data.map((item) => <span key={item.key} className={item.key} style={{ width: `${total ? item.value / total * 100 : 0}%` }} />)}</div>
    <div className="sentiment-list">{data.map((item) => <div key={item.key}>
      <span><i className={item.key} />{item.label}</span>
      <small>{formatNumber(item.value)} posts</small><strong>{total ? Math.round(item.value / total * 100) : 0}%</strong>
    </div>)}</div>
  </div>
}
