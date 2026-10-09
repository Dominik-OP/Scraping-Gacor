import {
  Archive,
  ArrowCounterClockwise,
  ArrowSquareOut,
  ArrowsClockwise,
  Broadcast,
  ChatCircle,
  ChatsCircle,
  CheckCircle,
  DownloadSimple,
  Eye,
  Hash,
  Heart,
  List,
  MagicWand,
  Moon,
  Plus,
  Pulse,
  Repeat,
  Sun,
  Trash,
  Users,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SentimentChart } from './Charts'
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
  getRun,
  getTopics,
  restoreTopic,
  type Bootstrap,
  type DashboardData,
  type Post,
  type Topic,
  type TopicInput,
} from '../server/api'

type Theme = 'light' | 'dark'
type SentimentFilter = 'all' | Post['sentiment']
type Notice = { message: string; error?: boolean } | null

const metricIcons = [ChatsCircle, Pulse, Users, Broadcast]

function Avatar({ name, source, large = false }: { name: string; source?: string; large?: boolean }) {
  return (
    <span className={`avatar${large ? ' avatar-large' : ''}`} aria-hidden={!source}>
      {source ? <img src={source} alt="" /> : initials(name)}
    </span>
  )
}

function Modal({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </section>
    </div>
  )
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
  const [theme, setTheme] = useState<Theme>('dark')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [notice, setNotice] = useState<Notice>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
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

  const loadDashboard = useCallback(async (topicId: number) => {
    setLoading(true)
    setPageError(null)
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
  }, [])

  useEffect(() => {
    if (selectedId === null) {
      setDashboard(null)
      setLoading(false)
      return
    }
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

  const metrics = useMemo(() => {
    const summary = dashboard?.summary
    return [
      { label: 'Total Posts', value: summary?.mentions ?? 0, note: 'Collected posts' },
      { label: 'Total Engagement', value: summary?.engagement ?? 0, note: 'Likes, reposts, replies, and quotes' },
      { label: 'Unique Authors', value: summary?.authors ?? 0, note: 'Accounts contributing posts' },
      { label: 'Combined Followers', value: summary?.audience ?? 0, note: 'Total followers across unique authors' },
    ]
  }, [dashboard])

  const topConversations = useMemo(() => {
    const top = dashboard?.top_posts
    return [
      { label: 'Most Liked', note: 'Highest number of likes', post: top?.most_liked ?? null, Icon: Heart, value: top?.most_liked?.like_count ?? 0 },
      { label: 'Most Reposted', note: 'Highest number of reposts', post: top?.most_reposted ?? null, Icon: Repeat, value: top?.most_reposted?.retweet_count ?? 0 },
      { label: 'Most Discussed', note: 'Replies and quotes', post: top?.most_discussed ?? null, Icon: ChatCircle, value: (top?.most_discussed?.reply_count ?? 0) + (top?.most_discussed?.quote_count ?? 0) },
      { label: 'Highest Engagement', note: 'Total Engagement', post: top?.most_popular ?? null, Icon: Broadcast, value: top?.most_popular ? top.most_popular.like_count + top.most_popular.retweet_count + top.most_popular.reply_count + top.most_popular.quote_count : 0 },
    ]
  }, [dashboard])

  const filteredPosts = useMemo(() => {
    const posts = dashboard?.posts ?? []
    return sentimentFilter === 'all'
      ? posts
      : posts.filter((post) => post.sentiment === sentimentFilter)
  }, [dashboard, sentimentFilter])

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
      setActiveAIId(selectedTopic.id)
      await loadDashboard(selectedTopic.id)
      showNotice('AI analysis started.')
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
            <i />{initial.config.token_configured ? 'Apify Connected' : 'Collection Unavailable'}
          </span>
          <small>{initial.config.token_configured ? 'Ready to collect posts' : 'Collection is not configured'}</small>
          <span className={`connection-state ai${initial.config.gemini_configured ? '' : ' unavailable'}`}>
            <i />{initial.config.gemini_configured ? 'AI Analysis Ready' : 'AI Analysis Unavailable'}
          </span>
          <small>{initial.config.gemini_configured ? initial.config.gemini_model : 'AI analysis is not configured'}</small>
        </div>
      </aside>

      {mobileNav && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><List /></button>
          <div className="page-identity">
            <span>Social Listening</span>
            <h1>{selectedTopic?.name ?? 'Conversation Overview'}</h1>
            <p>{selectedTopic?.query ?? 'Create a topic to monitor conversations on X.'}</p>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            {selectedTopic && <>
              <button className="secondary-button" type="button" onClick={handleExport}><DownloadSimple />Export CSV</button>
              <button className="secondary-button ai-button" type="button" onClick={openAIAnalysis} disabled={activeAIId === selectedTopic.id}><MagicWand />{activeAIId === selectedTopic.id ? 'Analyzing…' : 'AI Analysis'}</button>
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
            <section className="metrics-strip" aria-label="Key metrics">
              {metrics.map((metric, index) => {
                const Icon = metricIcons[index]
                return (
                  <article className="metric-item" key={metric.label}>
                    <div className="metric-label"><Icon /><span>{metric.label}</span></div>
                    <strong>{formatNumber(metric.value)}</strong>
                    <small>{metric.note}</small>
                  </article>
                )
              })}
            </section>

            <div className="analytics-grid">
              <section className="panel ai-summary-panel">
                <div className="panel-heading">
                  <div><h2>AI Summary</h2><p>Key findings from collected posts.</p></div>
                  <span className={`ai-status ${dashboard.ai_analysis?.status ?? 'idle'}`}><MagicWand />{dashboard.ai_analysis?.status === 'succeeded' ? 'Completed' : dashboard.ai_analysis?.status === 'failed' ? 'Failed' : dashboard.ai_analysis?.status === 'queued' || dashboard.ai_analysis?.status === 'running' ? 'Analyzing…' : 'Not Analyzed'}</span>
                </div>
                {dashboard.ai_analysis?.status === 'succeeded' ? (
                  <div className="ai-summary-content">
                    <p className="ai-summary-lead">{dashboard.ai_analysis.summary}</p>
                    <div className="ai-sentiment-insights">
                      <article className="positive"><span>Positive Themes</span><p>{dashboard.ai_analysis.positive_summary}</p></article>
                      <article className="negative"><span>Negative Themes</span><p>{dashboard.ai_analysis.negative_summary}</p></article>
                    </div>
                    <div className="ai-topics"><span>Key Topics</span><div>{dashboard.ai_analysis.key_topics.map((topic) => <b key={topic}>{topic}</b>)}</div></div>
                    <small>Analyzed with {dashboard.ai_analysis.model} · {formatDate(dashboard.ai_analysis.analyzed_at, true)}</small>
                  </div>
                ) : dashboard.ai_analysis?.status === 'queued' || dashboard.ai_analysis?.status === 'running' ? (
                  <div className="ai-summary-empty working"><MagicWand /><strong>Analysis in Progress</strong><p>The summary will appear when analysis is complete.</p></div>
                ) : dashboard.ai_analysis?.status === 'failed' ? (
                  <div className="ai-summary-empty failed"><WarningCircle /><strong>Analysis Failed</strong><p>{dashboard.ai_analysis.error}</p><button className="secondary-button" type="button" onClick={openAIAnalysis}>Retry Analysis</button></div>
                ) : (
                  <div className="ai-summary-empty"><MagicWand /><strong>No Analysis Yet</strong><p>Analyze collected posts to identify key themes and summarize the conversation.</p><button className="secondary-button" type="button" onClick={openAIAnalysis}>Analyze Posts</button></div>
                )}
              </section>
              <section className="panel sentiment-panel">
                <div className="panel-heading"><div><h2>Sentiment Overview</h2><p>Rule-based sentiment across collected posts.</p></div></div>
                <SentimentChart values={dashboard.sentiment} />
              </section>
            </div>

            <section className="top-conversations-section">
              <div className="section-heading"><div><h2>Top Posts</h2><p>Posts ranked by public engagement metrics on X.</p></div></div>
              <div className="top-conversation-grid">
                {topConversations.map(({ label, note, post, Icon, value }) => (
                  <article className="top-conversation-card" key={label}>
                    <header><span><Icon />{label}</span><b>{formatNumber(value)}</b></header>
                    {post ? <><p>{post.text}</p><footer><span>@{post.author_username}</span><small>{note}</small><a href={post.url} target="_blank" rel="noreferrer" aria-label={`View ${label} on X`}><ArrowSquareOut /></a></footer></> : <div className="compact-empty">No posts collected.</div>}
                  </article>
                ))}
              </div>
            </section>

            <div className="insight-grid">
              <section className="panel author-panel">
                <div className="panel-heading"><div><h2>Top Authors</h2><p>Ranked by total engagement.</p></div></div>
                <div className="author-list">
                  {dashboard.top_authors.length ? dashboard.top_authors.map((author) => (
                    <div className="author-row" key={author.author_username}>
                      <Avatar name={author.author_name} source={author.author_avatar} />
                      <div><strong>{author.author_name}</strong><span>@{author.author_username} · {formatCount(author.followers, 'follower')}</span></div>
                      <b>{formatNumber(author.engagement)}<small>engagement</small></b>
                    </div>
                  )) : <EmptyCompact text="No authors to display." />}
                </div>
              </section>

              <section className="panel hashtag-panel">
                <div className="panel-heading"><div><h2>Related Hashtags</h2><p>Hashtags found in collected posts.</p></div></div>
                {dashboard.hashtags.length ? (
                  <div className="hashtag-cloud">{dashboard.hashtags.map((item) => <span key={item.tag}><Hash />{item.tag}<b>{formatNumber(item.count)}</b></span>)}</div>
                ) : <EmptyCompact text="No hashtags found." />}
              </section>

              <section className="panel quality-panel">
                <div className="panel-heading"><div><h2>Latest Collection</h2><p>Status and results of the latest collection.</p></div></div>
                {dashboard.last_run ? (
                  <dl className="run-facts">
                    <div><dt>Status</dt><dd className={`run-status ${dashboard.last_run.status}`}>{runLabels[dashboard.last_run.status]}</dd></div>
                    <div><dt>Updated</dt><dd>{formatDate(dashboard.last_run.finished_at || dashboard.last_run.requested_at, true)}</dd></div>
                    <div><dt>Received</dt><dd>{formatCount(dashboard.last_run.items_received, 'post')}</dd></div>
                    <div><dt>New Posts</dt><dd>{formatCount(dashboard.last_run.items_new, 'post')}</dd></div>
                  </dl>
                ) : <EmptyCompact text="No collection history." />}
              </section>
            </div>

            <section className="conversation-panel">
              <div className="conversation-header">
                <div><h2>Recent Posts</h2><p>Sorted by publication date. View each post on X for its original context.</p></div>
                <label className="filter-field"><span>Sentiment Filter</span><select value={sentimentFilter} onChange={(event) => setSentimentFilter(event.target.value as SentimentFilter)}><option value="all">All</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></label>
              </div>
              <div className="conversation-list">
                {filteredPosts.length ? filteredPosts.map((post) => <ConversationRow key={post.tweet_id} post={post} />) : <EmptyCompact text="No posts match this filter." />}
              </div>
            </section>
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
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAiModal(false)} disabled={submitting}>Cancel</button><button className="primary-button" type="button" onClick={handleAnalyze} disabled={submitting}><MagicWand />{submitting ? 'Starting…' : 'Start Analysis'}</button></div>
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
  )
}

function ConversationRow({ post }: { post: Post }) {
  return (
    <article className="conversation-row">
      <div className="conversation-author">
        <Avatar name={post.author_name} source={post.author_avatar} large />
        <div><strong>{post.author_name}</strong><span>@{post.author_username}</span><small>{formatCount(post.author_followers, 'follower')}</small></div>
      </div>
      <div className="conversation-copy">
        <p>{post.text}</p>
        <div><span className={`sentiment-badge ${post.sentiment}`}>{sentimentLabels[post.sentiment]}</span><time>{formatDate(post.created_at, true)}</time>{post.hashtags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div>
      </div>
      <div className="conversation-stats">
        <span><Heart />{formatNumber(post.like_count)}</span>
        <span><Repeat />{formatNumber(post.retweet_count)}</span>
        <span><ChatCircle />{formatNumber(post.reply_count)}</span>
        <span><Eye />{formatNumber(post.view_count)}</span>
        <div className="conversation-actions"><a href={post.url} target="_blank" rel="noreferrer">View on X<ArrowSquareOut /></a></div>
      </div>
    </article>
  )
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
