export const sentimentLabels = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
} as const

export const runLabels = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Completed',
  failed: 'Failed',
} as const

export function formatNumber(value: number | null | undefined) {
  const number = Number(value || 0)
  return new Intl.NumberFormat('en-US', {
    notation: number >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(number)
}

export function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function formatCount(value: number, noun: 'post' | 'follower') {
  return `${formatNumber(value)} ${noun}${value === 1 ? '' : 's'}`
}

export function initials(name: string) {
  return (name || 'X')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}
