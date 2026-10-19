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
  author_location: string
  author_id: string
  conversation_id: string
  reply_to_post_id: string
  author_verified: boolean
  region: string | null
  region_source: string | null
  region_resolution: string
  province_code: string | null
}

export type SentimentCounts = { positive: number; neutral: number; negative: number }

export type ProvinceRegion = {
  code: string
  name: string
  col: number
  row: number
  posts: number
  authors: number
  threads: number
  engagement: number
  views: number
  share: number
  heat: number
  recent_posts: number
  trend: 'rising' | 'steady' | 'cooling' | null
  sentiment: SentimentCounts
  net_sentiment: number
  top_hashtags: string[]
  top_cities: Array<{ name: string; posts: number }>
  mentioned_in: number
  mention_heat: number
}

export type GeoInsights = {
  coverage: {
    posts: number
    province: number
    country_only: number
    foreign: number
    unknown: number
    located_share: number
    authors: number
    authors_located: number
    threads: number
    posts_with_thread: number
    sources: Partial<Record<'place' | 'coordinates' | 'profile' | 'flag', number>>
  }
  trend_window: { latest: string | null; recent_hours: number; enabled: boolean; recent_posts: number }
  provinces: ProvinceRegion[]
  cities: Array<{
    name: string
    province_code: string
    province: string
    posts: number
    authors: number
    engagement: number
    net_sentiment: number
  }>
  foreign: Array<{ country: string; posts: number }>
  mentions: Array<{
    code: string
    name: string
    posts: number
    engagement: number
    net_sentiment: number
    top_cities: string[]
  }>
}

export type InteractionType = 'reply' | 'mention' | 'quote' | 'retweet'
export type NetworkRole = 'influencer' | 'bridge' | 'conversation_driver' | 'amplifier' | 'referenced' | 'participant'

export type NetworkActor = {
  id: string
  username: string
  name: string
  avatar: string
  followers: number
  verified: boolean
  posts: number
  engagement: number
  in_degree: number
  out_degree: number
  interactions_received: number
  interactions_sent: number
  received: Record<InteractionType, number>
  pagerank: number
  influence: number
  betweenness: number
  community: number | null
  role: NetworkRole
  location: string | null
  province_code: string | null
}

export type NetworkInsights = {
  stats: {
    nodes: number
    edges: number
    interactions: number
    authors: number
    isolated_authors: number
    referenced_accounts: number
    density: number
    reciprocity: number
    average_degree: number
    clustering: number
    components: number
    largest_component_share: number
    communities: number
    modularity: number
    centralization: number
    interaction_types: Record<InteractionType, number>
    roles: Partial<Record<NetworkRole, number>>
    betweenness_sampled: boolean
  }
  actors: NetworkActor[]
  brokers: NetworkActor[]
  communities: Array<{
    id: number
    label: string
    size: number
    share: number
    internal_interactions: number
    authors: number
    top_members: Array<{ username: string; name: string; influence: number }>
    top_hashtags: string[]
    sentiment: SentimentCounts
    top_region: string | null
  }>
  strongest_ties: Array<{ source: string; target: string; count: number; types: Partial<Record<InteractionType, number>> }>
  hashtag_pairs: Array<{ tags: [string, string]; count: number }>
  graph: {
    nodes: Array<NetworkActor & { x: number; y: number }>
    edges: Array<{ source: string; target: string; weight: number; count: number; type: InteractionType }>
    truncated: boolean
  }
}

export type Insights = {
  topic_id: number
  posts_analyzed: number
  posts_total: number
  geo: GeoInsights
  network: NetworkInsights
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

const API_BASE = process.env.SINYALX_BACKEND_URL || process.env.SINYALX_API_URL || 'http://127.0.0.1:8765'

async function backend<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE.replace(/\/$/, '')}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('Unable to connect to the service. Try again shortly.')
  }

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String(payload.error)
      : `The request failed (${response.status}). Try again.`
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
      error: error instanceof Error ? error.message : 'Unable to load the dashboard. Try again.',
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

export const getInsights = createServerFn({ method: 'GET' })
  .validator((topicId: number) => topicId)
  .handler(async ({ data }) => backend<Insights>(`/api/topics/${data}/insights`))

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
  .handler(async ({ data }) => backend<{ topic_id: number; status: 'succeeded'; model: string }>(
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
