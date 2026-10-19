import {
  Archive,
  ArrowCounterClockwise,
  ArrowSquareOut,
  ArrowsClockwise,
  Broadcast,
  IconContext,
  ChatCircle,
  ChatsCircle,
  CheckCircle,
  DownloadSimple,
  Eye,
  Heart,
  List,
  MagicWand,
  MapPin,
  Moon,
  Plus,
  Pulse,
  Repeat,
  SealCheck,
  Sun,
  Trash,
  Users,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SentimentChart } from './Charts'
import { GeoPanel, InsightsSkeleton, NetworkPanel, sourceLabels } from './Insights'
import { formatCount, formatDate, formatNumber, initials, runLabels, sentimentLabels } from '../lib/format'
import {
  analyzeTopic,
  archiveTopic,
  collectTopic,
  createTopic,
  deleteTopicPermanently,
  exportTopic,
  getArchivedTopics,
  getDashboard,
  getInsights,
  getRun,
  getTopics,
  restoreTopic,
  type Bootstrap,
  type DashboardData,
  type Insights,
  type Post,
  type Topic,
  type TopicInput,
} from '../server/api'

type Theme = 'light' | 'dark'
type DashboardView = 'overview' | 'regions' | 'network' | 'posts'
type SentimentFilter = 'all' | Post['sentiment']
type Notice = { message: string; error?: boolean } | null

const metricIcons = [ChatsCircle, Users, Pulse]
const views: Array<{ id: DashboardView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'regions', label: 'Regions' },
  { id: 'network', label: 'Network' },
  { id: 'posts', label: 'Posts' },
]

function Avatar({ name, source, large = false }: { name: string; source?: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? ' avatar-large' : ''}`} aria-hidden={!source}>
      {source ? <img src={source} alt="" /> : initials(name)}
    </span>
  )
}

function Modal({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return <dialog ref={dialogRef} className="modal-card" aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    {children}
  </dialog>
}

export function DashboardApp({ initial }: { initial: Bootstrap }) {
  const [topics, setTopics] = useState(initial.topics)
  const [selectedId, setSelectedId] = useState<number | null>(initial.topics[0]?.id ?? null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(Boolean(initial.topics.length))
  const [pageError, setPageError] = useState<string | null>(initial.error)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [topicModal, setTopicModal] = useState(false)
  const [collectModal, setCollectModal] = useState(false)
  const [aiModal, setAiModal] = useState(false)
  const [activeAIId, setActiveAIId] = useState<number | null>(null)
  const [archivedTopics, setArchivedTopics] = useState<Topic[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Topic | null>(null)
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Topic | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const [view, setView] = useState<DashboardView>('overview')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const [notice, setNotice] = useState<Notice>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const insightsRequest = useRef(0)

  const selectedTopic = topics.find((topic) => topic.id === selectedId) ?? null

  const showNotice = useCallback((message: string, error = false) => {
    setNotice({ message, error })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const saved = localStorage.getItem('sinyalx-theme') as Theme | null
    const preferred: Theme = 'light'
    setTheme(saved === 'light' || saved === 'dark' ? saved : preferred)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('sinyalx-theme', theme)
  }, [theme])

  useEffect(() => {
    void getArchivedTopics()
      .then((response) => setArchivedTopics(response.topics))
      .catch(() => setArchivedTopics([]))
  }, [])

  const loadInsights = useCallback(async (topicId: number) => {
    // Ignore responses for a topic the user has already left.
    const request = ++insightsRequest.current
    setInsightsLoading(true)
    setInsightsError(null)
    try {
      const next = await getInsights({ data: topicId })
      if (request === insightsRequest.current) setInsights(next)
    } catch (error) {
      if (request === insightsRequest.current) {
        setInsights(null)
        setInsightsError(error instanceof Error ? error.message : 'Unable to load regional and network insights.')
      }
    } finally {
      if (request === insightsRequest.current) setInsightsLoading(false)
    }
  }, [])

  const loadDashboard = useCallback(async (topicId: number) => {
    setLoading(true)
    setPageError(null)
    void loadInsights(topicId)
    try {
      const next = await getDashboard({ data: topicId })
      setDashboard(next)
      if (next.last_run && ['queued', 'running'].includes(next.last_run.status)) {
        setActiveRunId(next.last_run.id)
      }
      if (next.ai_analysis && ['queued', 'running'].includes(next.ai_analysis.status)) {
        setActiveAIId(topicId)
      }
    } catch (error) {
      setDashboard(null)
      setPageError(error instanceof Error ? error.message : 'Unable to load the dashboard. Try again.')
    } finally {
      setLoading(false)
    }
  }, [loadInsights])

  useEffect(() => {
    if (selectedId === null) {
      setDashboard(null)
      setInsights(null)
      setLoading(false)
      return
    }
    setInsights((current) => current?.topic_id === selectedId ? current : null)
    setRegionFilter('all')
    setSentimentFilter('all')
    setView('overview')
    void loadDashboard(selectedId)
  }, [loadDashboard, selectedId])

  const refreshTopics = useCallback(async (preferredId?: number) => {
    const [response, archivedResponse] = await Promise.all([getTopics(), getArchivedTopics()])
    setTopics(response.topics)
    setArchivedTopics(archivedResponse.topics)
    if (preferredId && response.topics.some((topic) => topic.id === preferredId)) {
      setSelectedId(preferredId)
    } else if (!response.topics.some((topic) => topic.id === selectedId)) {
      setSelectedId(response.topics[0]?.id ?? null)
    }
    return response.topics
  }, [selectedId])

  useEffect(() => {
    if (!activeRunId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const run = await getRun({ data: activeRunId })
        if (cancelled) return
        if (run.status === 'queued' || run.status === 'running') {
          timer = setTimeout(poll, 2200)
          return
        }
        setActiveRunId(null)
        await refreshTopics(run.topic_id)
        await loadDashboard(run.topic_id)
        if (run.status === 'succeeded') {
          showNotice(`${formatCount(run.items_new, 'post')} added.`)
        } else {
          showNotice(run.error || 'Post collection failed. Try again.', true)
        }
      } catch (error) {
        if (!cancelled) {
          showNotice(error instanceof Error ? error.message : 'Unable to check collection status. Try again.', true)
          timer = setTimeout(poll, 3000)
        }
      }
    }

    timer = setTimeout(poll, 1200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeRunId, loadDashboard, refreshTopics, showNotice])

  useEffect(() => {
    if (activeAIId === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const next = await getDashboard({ data: activeAIId })
        if (cancelled) return
        if (selectedId === activeAIId) setDashboard(next)
        if (next.ai_analysis?.status === 'queued' || next.ai_analysis?.status === 'running') {
          timer = setTimeout(poll, 2500)
          return
        }
        setActiveAIId(null)
        if (next.ai_analysis?.status === 'succeeded') {
          showNotice('AI analysis completed.')
        } else {
          showNotice(next.ai_analysis?.error || 'AI analysis failed. Try again.', true)
        }
      } catch (error) {
        if (!cancelled) {
          setActiveAIId(null)
          showNotice(error instanceof Error ? error.message : 'Unable to check analysis status. Try again.', true)
        }
      }
    }

    timer = setTimeout(poll, 1400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeAIId, selectedId, showNotice])

  const metrics = [
    { label: 'Posts collected', value: dashboard?.summary.mentions ?? 0, note: 'In this topic sample' },
    { label: 'People posting', value: dashboard?.summary.authors ?? 0, note: 'Unique accounts' },
    { label: 'Engagement', value: dashboard?.summary.engagement ?? 0, note: 'Likes, reposts, replies and quotes' },
  ]
  const featuredPost = dashboard?.top_posts.most_popular

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const blocks = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.remove('reveal-pending')
        observer.unobserve(entry.target)
      }
    }, { threshold: 0 })
    blocks.forEach((block) => { block.classList.add('reveal-pending'); observer.observe(block) })
    return () => { observer.disconnect(); blocks.forEach((block) => block.classList.remove('reveal-pending')) }
  }, [view, dashboard, insights])

  const filteredPosts = useMemo(() => {
    const posts = dashboard?.posts ?? []
    return posts.filter((post) => (sentimentFilter === 'all' || post.sentiment === sentimentFilter)
      && (regionFilter === 'all' || (regionFilter === 'unknown' ? !post.province_code : post.province_code === regionFilter)))
  }, [dashboard, sentimentFilter, regionFilter])

  const postRegions = useMemo(() => {
    const names = new Map<string, string>()
    for (const post of dashboard?.posts ?? []) {
      if (post.province_code && post.region) names.set(post.province_code, post.region.split(', ').pop() ?? post.region)
    }
    return [...names.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [dashboard])

  async function handleCreateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    const form = event.currentTarget
    const values = new FormData(form)
    const input: TopicInput = {
      name: String(values.get('name') ?? ''),
      query: String(values.get('query') ?? ''),
      language: String(values.get('language') ?? 'id') as TopicInput['language'],
      lookback_days: Number(values.get('lookback_days') ?? 1),
      max_items: Number(values.get('max_items') ?? 100),
    }
    try {
      const topic = await createTopic({ data: input })
      await refreshTopics(topic.id)
      setSelectedId(topic.id)
      setTopicModal(false)
      form.reset()
      showNotice('Topic created. Collect posts when you are ready.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create the topic. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCollect() {
    if (!selectedTopic) return
    setSubmitting(true)
    try {
      const result = await collectTopic({ data: selectedTopic.id })
      setActiveRunId(result.run_id)
      setCollectModal(false)
      showNotice('Post collection started.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Unable to start post collection. Try again.', true)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleExport() {
    if (!selectedTopic) return
    try {
      const result = await exportTopic({ data: selectedTopic.id })
      const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${selectedTopic.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'topic'}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Unable to export the CSV. Try again.', true)
    }
  }

  function openAIAnalysis() {
    if (!selectedTopic) return
    if (!initial.config.gemini_configured) {
      showNotice('AI analysis is not configured. Contact your administrator.', true)
      return
    }
    if (!dashboard?.summary.mentions) {
      showNotice('Collect posts before starting an analysis.', true)
      return
    }
    setAiModal(true)
  }

  async function handleAnalyze() {
    if (!selectedTopic) return
    setSubmitting(true)
    try {
      await analyzeTopic({ data: selectedTopic.id })
      setAiModal(false)
      await loadDashboard(selectedTopic.id)
      showNotice('AI analysis completed.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Unable to start AI analysis. Try again.', true)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchiveTopic() {
    if (!archiveTarget) return
    setSubmitting(true)
    try {
      await archiveTopic({ data: archiveTarget.id })
      setArchiveTarget(null)
      await refreshTopics()
      showNotice('Topic archived.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Unable to archive the topic. Try again.', true)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRestoreTopic(topic: Topic) {
    setSubmitting(true)
    try {
      await restoreTopic({ data: topic.id })
      await refreshTopics(topic.id)
      setArchiveOpen(false)
      showNotice('Topic restored.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Unable to restore the topic. Try again.', true)
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePermanentDelete() {
    if (!permanentDeleteTarget) return
    setSubmitting(true)
    try {
      await deleteTopicPermanently({ data: permanentDeleteTarget.id })
      setPermanentDeleteTarget(null)
      await refreshTopics()
      showNotice('Topic and associated records permanently deleted.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Unable to delete the topic. Try again.', true)
    } finally {
      setSubmitting(false)
    }
  }

  function openCollection() {
    if (!selectedTopic) return
    if (!initial.config.token_configured) {
      showNotice('Post collection is not configured. Contact your administrator.', true)
      return
    }
    setCollectModal(true)
  }

  return (
    <IconContext.Provider value={{ weight: 'bold' }}>
    <div className="app-shell">
      <aside className={`sidebar${mobileNav ? ' sidebar-open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">IB</div>
          <div><strong>IndonesiaBerkumpul</strong><span>Social Listening</span></div>
          <button className="icon-button mobile-close" type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X /></button>
        </div>

        <div className="sidebar-heading">
          <span>Topics</span>
          <button className="icon-button" type="button" onClick={() => setTopicModal(true)} aria-label="Add topic"><Plus /></button>
        </div>

        <nav className="topic-list" aria-label="Topics">
          {topics.length ? topics.map((topic) => (
            <div className={`topic-row${topic.id === selectedId ? ' active' : ''}`} key={topic.id}>
              <button
                type="button"
                className="topic-button"
                onClick={() => { setSelectedId(topic.id); setMobileNav(false) }}
              >
                <span><strong>{topic.name}</strong><small>{`Last ${topic.lookback_days} ${topic.lookback_days === 1 ? 'day' : 'days'}`}</small></span>
                <b>{formatNumber(topic.post_count)}</b>
              </button>
              <button className="topic-archive-button" type="button" onClick={() => setArchiveTarget(topic)} aria-label={`Archive topic ${topic.name}`} title="Archive Topic"><Archive /></button>
            </div>
          )) : <p className="sidebar-empty">No topics yet.</p>}
        </nav>

        <section className={`archive-section${archiveOpen ? ' open' : ''}`}>
          <button className="archive-toggle" type="button" onClick={() => setArchiveOpen((value) => !value)} aria-expanded={archiveOpen}>
            <span><Archive />Archive</span><b>{formatNumber(archivedTopics.length)}</b>
          </button>
          {archiveOpen && (
            <div className="archive-list">
              {archivedTopics.length ? archivedTopics.map((topic) => (
                <div className="archive-row" key={topic.id}>
                  <div><strong>{topic.name}</strong><small>{formatCount(topic.post_count, 'post')}</small></div>
                  <button type="button" onClick={() => void handleRestoreTopic(topic)} disabled={submitting} aria-label={`Restore topic ${topic.name}`} title="Restore"><ArrowCounterClockwise /></button>
                  <button className="archive-delete" type="button" onClick={() => setPermanentDeleteTarget(topic)} disabled={submitting} aria-label={`Permanently delete topic ${topic.name}`} title="Delete Permanently"><Trash /></button>
                </div>
              )) : <p>No archived topics.</p>}
            </div>
          )}
        </section>

        <div className="connection-panel">
          <span className={`connection-state${initial.config.token_configured ? '' : ' unavailable'}`}>
            <i />{initial.config.token_configured ? 'Collection ready' : 'Collection unavailable'}
          </span>
          <span className={`connection-state ai${initial.config.gemini_configured ? '' : ' unavailable'}`}>
            <i />{initial.config.gemini_configured ? 'AI summary ready' : 'AI summary unavailable'}
          </span>
        </div>
      </aside>

      {mobileNav && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><List /></button>
          <div className="page-identity">
            <span>Topic dashboard</span>
            <h1>{selectedTopic?.name ?? 'Conversation Overview'}</h1>
            <p>{selectedTopic ? `Search: ${selectedTopic.query}` : 'Create a topic to monitor conversations on X.'}</p>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            {selectedTopic && <>
              <button className="secondary-button" type="button" onClick={handleExport}><DownloadSimple />Export CSV</button>
              <button className="primary-button" type="button" onClick={openCollection} disabled={Boolean(activeRunId)}><ArrowsClockwise />{activeRunId ? 'Collecting…' : 'Collect Posts'}</button>
            </>}
          </div>
        </header>

        {activeRunId && (
          <div className="run-banner" role="status">
            <span className="run-icon"><ArrowsClockwise /></span>
            <div><strong>Collecting Posts from X</strong><span>Collection is running. The dashboard updates automatically.</span></div>
            <div className="run-track"><span /></div>
          </div>
        )}

        {pageError && (
          <div className="inline-alert error" role="alert"><WarningCircle /><span>{pageError}</span></div>
        )}

        {!selectedTopic ? (
          <section className="empty-page">
            <div className="empty-icon"><Broadcast /></div>
            <h2>No Topics Yet</h2>
            <p>Create a topic and add a search query to start collecting posts.</p>
            <button className="primary-button" type="button" onClick={() => setTopicModal(true)}><Plus />Create Topic</button>
          </section>
        ) : loading && !dashboard ? (
          <DashboardSkeleton />
        ) : dashboard ? (
          <div className="dashboard-content">
            <div className="dashboard-toolbar">
              <nav className="view-nav" aria-label="Dashboard views">
                {views.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
              </nav>
              <span className="updated-label">{dashboard.last_run ? `Updated ${formatDate(dashboard.last_run.finished_at || dashboard.last_run.requested_at)}` : 'No collection yet'}</span>
            </div>

            {view === 'overview' && <div className="view-content">
              <section className="metrics-strip" aria-label="Key metrics" data-reveal>
                {metrics.map((metric, index) => {
                  const Icon = metricIcons[index]
                  return <article className="metric-item" key={metric.label}>
                    <div className="metric-label"><Icon /><span>{metric.label}</span></div>
                    <strong>{formatNumber(metric.value)}</strong><small>{metric.note}</small>
                  </article>
                })}
              </section>
              <div className="analytics-grid" data-reveal>
                <section className="panel ai-summary-panel">
                  <div className="panel-heading">
                    <div><h2>What people are saying</h2><p>An AI brief from up to 10 high-engagement posts.</p></div>
                    <button className="text-button" type="button" onClick={openAIAnalysis} disabled={activeAIId === selectedTopic.id || !dashboard.summary.mentions}><MagicWand />{activeAIId === selectedTopic.id ? 'Analyzing…' : dashboard.ai_analysis?.status === 'succeeded' ? 'Refresh' : 'Generate Summary'}</button>
                  </div>
                  {dashboard.ai_analysis?.status === 'succeeded' ? <div className="ai-summary-content">
                    <p className="ai-summary-lead">{dashboard.ai_analysis.summary}</p>
                    <details className="disclosure">
                      <summary>Themes & source details</summary>
                      <div className="ai-sentiment-insights">
                        <article><span>Positive themes</span><p>{dashboard.ai_analysis.positive_summary}</p></article>
                        <article><span>Negative themes</span><p>{dashboard.ai_analysis.negative_summary}</p></article>
                      </div>
                      <div className="ai-topics">{dashboard.ai_analysis.key_topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
                      <p className="method-note">Generated {formatDate(dashboard.ai_analysis.analyzed_at, true)} with {dashboard.ai_analysis.model}. This summary covers a selected sample, not every post.</p>
                    </details>
                  </div> : <div className="ai-summary-empty">
                    <p>{dashboard.ai_analysis?.status === 'failed' ? dashboard.ai_analysis.error : activeAIId === selectedTopic.id ? 'Your summary is being prepared.' : 'Generate a summary to see the main themes in this conversation.'}</p>
                  </div>}
                </section>
                <section className="panel sentiment-panel">
                  <div className="panel-heading"><div><h2>Conversation tone</h2><p>Estimated sentiment from collected posts.</p></div></div>
                  <SentimentChart values={dashboard.sentiment} />
                </section>
              </div>
              {featuredPost && <section className="panel featured-post" data-reveal>
                <div className="panel-heading"><div><h2>Most engaged post</h2><p>The post with the most likes, reposts, replies and quotes.</p></div><a className="text-button" href={featuredPost.url} target="_blank" rel="noreferrer">View on X<ArrowSquareOut /></a></div>
                <p>{featuredPost.text}</p>
                <footer><span>@{featuredPost.author_username}</span><strong>{formatNumber(featuredPost.like_count + featuredPost.retweet_count + featuredPost.reply_count + featuredPost.quote_count)} interactions</strong></footer>
              </section>}
              <details className="disclosure collection-details">
                <summary>Collection details</summary>
                <div className="insight-grid">
                  <section><h3>Top authors by engagement</h3><div className="author-list">
                    {dashboard.top_authors.length ? dashboard.top_authors.map((author) => <div className="author-row" key={author.author_username}><Avatar name={author.author_name} source={author.author_avatar} /><div><strong>{author.author_name}</strong><span>@{author.author_username}</span></div><b>{formatNumber(author.engagement)}</b></div>) : <EmptyCompact text="No authors yet." />}
                  </div></section>
                  <section><h3>Hashtags in recent posts</h3><div className="hashtag-cloud">{dashboard.hashtags.length ? dashboard.hashtags.map((item) => <span key={item.tag}>#{item.tag}<b>{formatNumber(item.count)}</b></span>) : <EmptyCompact text="No hashtags found." />}</div></section>
                  <section><h3>Latest collection</h3>{dashboard.last_run ? <dl className="run-facts">
                    <div><dt>Status</dt><dd>{runLabels[dashboard.last_run.status]}</dd></div>
                    <div><dt>Received</dt><dd>{formatNumber(dashboard.last_run.items_received)}</dd></div>
                    <div><dt>New posts</dt><dd>{formatNumber(dashboard.last_run.items_new)}</dd></div>
                    <div><dt>Combined followers</dt><dd>{formatNumber(dashboard.summary.audience)}</dd></div>
                  </dl> : <EmptyCompact text="No collection history." />}</section>
                </div>
              </details>
            </div>}

            {(view === 'regions' || view === 'network') && <div className="view-content" data-reveal>
              {insightsError ? <div className="inline-alert error" role="alert"><WarningCircle /><span>{insightsError}</span><button className="secondary-button" type="button" onClick={() => void loadInsights(selectedTopic.id)}>Retry</button></div>
                : insights && insights.topic_id === selectedTopic.id ? <>
                  {view === 'network' && insights.posts_analyzed < insights.posts_total && <p className="method-note">Network analysis covers the latest {formatCount(insights.posts_analyzed, 'post')} of {formatNumber(insights.posts_total)}.</p>}
                  {view === 'regions' ? <GeoPanel key={selectedTopic.id} data={insights.geo} /> : <NetworkPanel key={selectedTopic.id} data={insights.network} />}
                  {insightsLoading && <p className="method-note" role="status">Refreshing insights…</p>}
                </> : <InsightsSkeleton />}
            </div>}

            {view === 'posts' && <section className="panel conversation-panel" data-reveal>
              <div className="conversation-header">
                <div><h2>Explore the posts</h2><p>Filters apply to the latest {formatCount(dashboard.posts.length, 'post')}. Export CSV includes all collected posts.</p></div>
                <div className="filter-group">
                  <label className="filter-field"><span>Region</span><select aria-label="Region" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}><option value="all">All regions</option>{postRegions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}<option value="unknown">No province identified</option></select></label>
                  <label className="filter-field"><span>Sentiment</span><select aria-label="Sentiment" value={sentimentFilter} onChange={(event) => setSentimentFilter(event.target.value as SentimentFilter)}><option value="all">All sentiments</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></label>
                </div>
              </div>
              <div className="conversation-list">
                {filteredPosts.length ? filteredPosts.map((post) => <ConversationRow key={post.tweet_id} post={post} />) : <EmptyCompact text="No posts match these filters." />}
              </div>
            </section>}
          </div>
        ) : null}
      </main>

      {notice && <div className={`toast${notice.error ? ' toast-error' : ''}`} role="status">{notice.error ? <WarningCircle /> : <CheckCircle />}<span>{notice.message}</span></div>}

      {topicModal && (
        <Modal title="New Topic" onClose={() => setTopicModal(false)}>
          <div className="modal-heading"><div><span>New Topic</span><h2>Create a Topic</h2></div><button className="icon-button" type="button" onClick={() => setTopicModal(false)} aria-label="Close"><X /></button></div>
          <form onSubmit={handleCreateTopic}>
            <label className="field"><span>Topic Name</span><input name="name" maxLength={60} required /><small>Use a short, descriptive name.</small></label>
            <label className="field"><span>X Search Query</span><textarea name="query" maxLength={300} required /><small>Use keywords, quoted phrases, OR, and supported X search operators.</small></label>
            <div className="form-grid">
              <label className="field"><span>Language</span><select name="language" defaultValue="id"><option value="id">Indonesian</option><option value="en">English</option><option value="any">All Languages</option></select></label>
              <label className="field"><span>Time Range</span><select name="lookback_days" defaultValue="1"><option value="1">24 Hours</option><option value="7">7 Days</option><option value="14">14 Days</option><option value="30">30 Days</option></select></label>
              <label className="field"><span>Maximum Posts</span><input type="number" name="max_items" min={20} max={1000} defaultValue={100} required /></label>
            </div>
            {formError && <p className="form-error"><WarningCircle />{formError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setTopicModal(false)}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Topic'}</button></div>
          </form>
        </Modal>
      )}

      {collectModal && selectedTopic && (
        <Modal title="Confirm Collection" onClose={() => setCollectModal(false)}>
          <div className="modal-heading"><div><span>Collection Cost</span><h2>Start Post Collection?</h2></div><button className="icon-button" type="button" onClick={() => setCollectModal(false)} aria-label="Close"><X /></button></div>
          <div className="collect-summary">
            <div><span>Topic</span><strong>{selectedTopic.name}</strong></div>
            <div><span>Maximum Posts</span><strong>{formatCount(selectedTopic.max_items, 'post')}</strong></div>
            <div><span>Maximum Cost</span><strong>US${initial.config.max_charge_usd.toFixed(2)}</strong></div>
          </div>
          <p className="modal-note">Apify may charge for collected posts. AI analysis uses a separate quota and runs only when you request it.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCollectModal(false)}>Cancel</button><button className="primary-button" type="button" onClick={handleCollect} disabled={submitting}>{submitting ? 'Starting…' : 'Start Collection'}</button></div>
        </Modal>
      )}

      {aiModal && selectedTopic && dashboard && (
        <Modal title="Confirm AI Analysis" onClose={() => !submitting && setAiModal(false)}>
          <div className="modal-heading"><div><span>AI Analysis</span><h2>Analyze “{selectedTopic.name}”?</h2></div><button className="icon-button" type="button" onClick={() => setAiModal(false)} aria-label="Close" disabled={submitting}><X /></button></div>
          <div className="collect-summary">
            <div><span>Posts</span><strong>{formatCount(dashboard.summary.mentions, 'post')}</strong></div>
            <div><span>Model</span><strong>{initial.config.gemini_model}</strong></div>
            <div><span>Output</span><strong>AI Summary</strong></div>
          </div>
          <p className="modal-note">Up to 10 posts with the highest engagement are sent to Gemini. This uses your AI quota, and the results are saved.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAiModal(false)} disabled={submitting}>Cancel</button><button className="primary-button" type="button" onClick={handleAnalyze} disabled={submitting}><MagicWand />{submitting ? 'Analyzing…' : 'Start Analysis'}</button></div>
        </Modal>
      )}

      {archiveTarget && (
        <Modal title="Archive Topic" onClose={() => !submitting && setArchiveTarget(null)}>
          <div className="modal-heading"><div><span>Archive Topic</span><h2>Archive “{archiveTarget.name}”?</h2></div><button className="icon-button" type="button" onClick={() => setArchiveTarget(null)} aria-label="Close" disabled={submitting}><X /></button></div>
          <div className="topic-action-preview"><Archive /><div><strong>{archiveTarget.name}</strong><span>{formatCount(archiveTarget.post_count, 'post')} collected</span></div></div>
          <p className="modal-note">This topic will move to the archive. Its records will remain available, and you can restore it later.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setArchiveTarget(null)} disabled={submitting}>Cancel</button><button className="primary-button" type="button" onClick={handleArchiveTopic} disabled={submitting}><Archive />{submitting ? 'Archiving…' : 'Archive Topic'}</button></div>
        </Modal>
      )}

      {permanentDeleteTarget && (
        <Modal title="Permanently Delete Topic" onClose={() => !submitting && setPermanentDeleteTarget(null)}>
          <div className="modal-heading"><div><span>Permanent Deletion</span><h2>Delete “{permanentDeleteTarget.name}”?</h2></div><button className="icon-button" type="button" onClick={() => setPermanentDeleteTarget(null)} aria-label="Close" disabled={submitting}><X /></button></div>
          <div className="topic-action-preview danger"><Trash /><div><strong>{permanentDeleteTarget.name}</strong><span>{formatCount(permanentDeleteTarget.post_count, 'post')} will be deleted</span></div></div>
          <p className="modal-note">All posts, analyses, and collection history for this topic will be permanently deleted. This cannot be undone.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPermanentDeleteTarget(null)} disabled={submitting}>Cancel</button><button className="danger-button" type="button" onClick={handlePermanentDelete} disabled={submitting}><Trash />{submitting ? 'Deleting…' : 'Delete Permanently'}</button></div>
        </Modal>
      )}
    </div>
    </IconContext.Provider>
  )
}

function ConversationRow({ post }: { post: Post }) {
  return <article className="conversation-row">
    <header className="conversation-author">
      <Avatar name={post.author_name} source={post.author_avatar} />
      <div><strong>{post.author_name}{post.author_verified && <SealCheck className="verified" aria-label="Verified" />}</strong><span>@{post.author_username}</span></div>
      <time>{formatDate(post.created_at, true)}</time>
    </header>
    <p className="post-text">{post.text}</p>
    <div className="post-meta"><span className={`sentiment-badge ${post.sentiment}`}>{sentimentLabels[post.sentiment]}</span><span className="post-region" title={`Source: ${sourceLabels[post.region_source ?? ''] ?? 'unavailable'}. Profile: ${post.author_location || 'unavailable'}`}><MapPin aria-hidden />{post.region || 'Location unavailable'}</span></div>
    <footer className="conversation-stats">
      <span title="Likes" aria-label={`${post.like_count} likes`}><Heart />{formatNumber(post.like_count)}</span>
      <span title="Reposts" aria-label={`${post.retweet_count} reposts`}><Repeat />{formatNumber(post.retweet_count)}</span>
      <span title="Replies" aria-label={`${post.reply_count} replies`}><ChatCircle />{formatNumber(post.reply_count)}</span>
      <span title="Views" aria-label={`${post.view_count} views`}><Eye />{formatNumber(post.view_count)}</span>
      <div className="conversation-actions">
        {/^\d+$/.test(post.conversation_id) && post.conversation_id !== post.tweet_id && <a href={`https://x.com/i/status/${post.conversation_id}`} target="_blank" rel="noreferrer">View Thread</a>}
        <a href={post.url} target="_blank" rel="noreferrer">View Post<ArrowSquareOut /></a>
      </div>
    </footer>
  </article>
}

function EmptyCompact({ text }: { text: string }) {
  return <div className="compact-empty">{text}</div>
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Loading dashboard">
      <div className="skeleton metrics-placeholder" />
      <div className="skeleton chart-placeholder" />
      <div className="skeleton list-placeholder" />
    </div>
  )
}
