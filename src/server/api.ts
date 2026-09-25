import { createServerFn } from '@tanstack/react-start'

export type Config = {
  token_configured: boolean
  actor: string
  max_charge_usd: number
  gemini_configured: boolean
  gemini_model: string
}

export type Topic = {
  id: number
  name: string
  query: string
  language: 'id' | 'en' | 'any'
  max_items: number
  lookback_days: number
  is_demo: number
  post_count: number
  last_collected_at: string | null
  archived_at: string | null
}

export type Run = {
  id: string
  topic_id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  requested_at: string
  finished_at: string | null
  apify_run_id: string | null
  items_received: number
  items_new: number
  error: string | null
}

export type Post = {
  tweet_id: string
  url: string
  text: string
  created_at: string
  author_name: string
  author_username: string
  author_avatar: string
  author_followers: number
  language: string
  like_count: number
  retweet_count: number
  reply_count: number
  quote_count: number
  view_count: number
  sentiment: 'positive' | 'neutral' | 'negative'
  sentiment_source: 'gemini' | 'lexicon'
  hashtags: string[]
}

export type AIAnalysis = {
  topic_id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  model: string
  analyzed_at: string | null
  post_count: number
  summary: string | null
  positive_summary: string | null
  negative_summary: string | null
  key_topics: string[]
  error: string | null
}

export type DashboardData = {
  topic: Topic
  summary: {
    mentions: number
    engagement: number
    authors: number
    views: number
    audience: number
  }
  sentiment: { positive: number; neutral: number; negative: number }
  timeline: Array<{ day: string; count: number }>
  top_authors: Array<{
    author_name: string
    author_username: string
    author_avatar: string
    followers: number
    mentions: number
    engagement: number
  }>
  hashtags: Array<{ tag: string; count: number }>
  top_posts: {
    most_liked: Post | null
    most_reposted: Post | null
    most_discussed: Post | null
    most_popular: Post | null
  }
  ai_analysis: AIAnalysis | null
  posts: Post[]
  last_run: Run | null
}

export type TopicInput = {
  name: string
  query: string
  language: 'id' | 'en' | 'any'
  max_items: number
  lookback_days: number
}

export type Bootstrap = {
  config: Config
  topics: Topic[]
  error: string | null
}

const API_BASE = process.env.SINYALX_API_URL ?? 'http://127.0.0.1:8765'

async function backend<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('Backend Python tidak dapat dihubungi. Jalankan python app.py terlebih dahulu.')
  }

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String(payload.error)
      : `Permintaan backend gagal (${response.status}).`
    throw new Error(message)
  }
  return payload as T
}

export const getBootstrap = createServerFn({ method: 'GET' }).handler(async (): Promise<Bootstrap> => {
  try {
    const [config, topicPayload] = await Promise.all([
      backend<Config>('/api/config'),
      backend<{ topics: Topic[] }>('/api/topics'),
    ])
    return { config, topics: topicPayload.topics, error: null }
  } catch (error) {
    return {
      config: {
        token_configured: false,
        actor: '',
        max_charge_usd: 0.5,
        gemini_configured: false,
        gemini_model: '',
      },
      topics: [],
      error: error instanceof Error ? error.message : 'Dashboard tidak dapat dimuat.',
    }
  }
})

export const getTopics = createServerFn({ method: 'GET' }).handler(async () => {
  return backend<{ topics: Topic[] }>('/api/topics')
})

export const getArchivedTopics = createServerFn({ method: 'GET' }).handler(async () => {
  return backend<{ topics: Topic[] }>('/api/topics/archived')
})

export const getDashboard = createServerFn({ method: 'GET' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<DashboardData>(`/api/topics/${data}/dashboard`))

export const getRun = createServerFn({ method: 'GET' })
  .validator((runId: string) => runId)
  .handler(async ({ data }) => backend<Run>(`/api/runs/${data}`))

export const createTopic = createServerFn({ method: 'POST' })
  .validator((input: TopicInput) => input)
  .handler(async ({ data }) => backend<Topic>('/api/topics', {
    method: 'POST',
    body: JSON.stringify(data),
  }))

export const collectTopic = createServerFn({ method: 'POST' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<{ run_id: string; status: Run['status'] }>(
    `/api/topics/${data}/collect`,
    { method: 'POST', body: JSON.stringify({ confirmed: true }) },
  ))

export const analyzeTopic = createServerFn({ method: 'POST' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<{ topic_id: number; status: 'queued'; model: string }>(
    `/api/topics/${data}/analyze`,
    { method: 'POST' },
  ))

export const archiveTopic = createServerFn({ method: 'POST' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<{ id: number; action: string; message: string }>(
    `/api/topics/${data}/archive`,
    { method: 'POST' },
  ))

export const restoreTopic = createServerFn({ method: 'POST' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<{ id: number; action: string; message: string }>(
    `/api/topics/${data}/restore`,
    { method: 'POST' },
  ))

export const deleteTopicPermanently = createServerFn({ method: 'POST' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<{ deleted: boolean; topic_id: number }>(
    `/api/topics/${data}`,
    { method: 'DELETE' },
  ))

export const exportTopic = createServerFn({ method: 'GET' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => {
    const content = await backend<string>(`/api/topics/${data}/export.csv`)
    return { content }
  })
