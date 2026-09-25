export const sentimentLabels = {
  positive: 'Positif',
  neutral: 'Netral',
  negative: 'Negatif',
} as const

export const runLabels = {
  queued: 'Menunggu',
  running: 'Berjalan',
  succeeded: 'Selesai',
  failed: 'Gagal',
} as const

export function formatNumber(value: number | null | undefined) {
  const number = Number(value || 0)
  return new Intl.NumberFormat('id-ID', {
    notation: number >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(number)
}

export function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Belum ada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tidak diketahui'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function initials(name: string) {
  return (name || 'X')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}
