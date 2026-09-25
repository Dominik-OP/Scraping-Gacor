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
import { formatDate, formatNumber, initials, runLabels, sentimentLabels } from '../lib/format'
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
      setPageError(error instanceof Error ? error.message : 'Data dashboard gagal dimuat.')
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
          showNotice(`${formatNumber(run.items_new)} tweet baru ditambahkan.`)
        } else {
          showNotice(run.error || 'Pengambilan data gagal.', true)
        }
      } catch (error) {
        if (!cancelled) {
          showNotice(error instanceof Error ? error.message : 'Status proses gagal diperiksa.', true)
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
          showNotice('Analisis Gemini selesai.')
        } else {
          showNotice(next.ai_analysis?.error || 'Analisis Gemini gagal.', true)
        }
      } catch (error) {
        if (!cancelled) {
          setActiveAIId(null)
          showNotice(error instanceof Error ? error.message : 'Status Gemini gagal diperiksa.', true)
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
      { label: 'Total percakapan', value: summary?.mentions ?? 0, note: 'Tweet tersimpan' },
      { label: 'Total interaksi', value: summary?.engagement ?? 0, note: 'Like, repost, balasan, kutipan' },
      { label: 'Akun unik', value: summary?.authors ?? 0, note: 'Sumber percakapan' },
      { label: 'Total audiens akun', value: summary?.audience ?? 0, note: 'Jumlah pengikut akun unik' },
    ]
  }, [dashboard])

  const topConversations = useMemo(() => {
    const top = dashboard?.top_posts
    return [
      { label: 'Paling disukai', note: 'Like tertinggi', post: top?.most_liked ?? null, Icon: Heart, value: top?.most_liked?.like_count ?? 0 },
      { label: 'Paling direpost', note: 'Jangkauan organik', post: top?.most_reposted ?? null, Icon: Repeat, value: top?.most_reposted?.retweet_count ?? 0 },
      { label: 'Diskusi terhangat', note: 'Balasan + kutipan', post: top?.most_discussed ?? null, Icon: ChatCircle, value: (top?.most_discussed?.reply_count ?? 0) + (top?.most_discussed?.quote_count ?? 0) },
      { label: 'Paling populer', note: 'Total interaksi', post: top?.most_popular ?? null, Icon: Broadcast, value: top?.most_popular ? top.most_popular.like_count + top.most_popular.retweet_count + top.most_popular.reply_count + top.most_popular.quote_count : 0 },
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
      showNotice('Topik dibuat. Ambil data saat Anda siap.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Topik gagal dibuat.')
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
      showNotice('Pengambilan data dimulai.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Pengambilan data gagal dimulai.', true)
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
      anchor.download = `${selectedTopic.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'topik'}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'CSV gagal dibuat.', true)
    }
  }

  function openAIAnalysis() {
    if (!selectedTopic) return
    if (!initial.config.gemini_configured) {
      showNotice('Isi API_GEMINI_TOKEN di file .env terlebih dahulu.', true)
      return
    }
    if (!dashboard?.summary.mentions) {
      showNotice('Belum ada percakapan untuk dianalisis.', true)
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
      showNotice('Gemini mulai menganalisis percakapan.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Analisis Gemini gagal dimulai.', true)
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
      showNotice('Topik dipindahkan ke Arsip.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Topik gagal diarsipkan.', true)
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
      showNotice('Topik dipulihkan ke daftar pantauan.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Topik gagal dipulihkan.', true)
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
      showNotice('Topik dan seluruh datanya dihapus permanen.')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Topik gagal dihapus permanen.', true)
    } finally {
      setSubmitting(false)
    }
  }

  function openCollection() {
    if (!selectedTopic) return
    if (selectedTopic.is_demo) {
      setTopicModal(true)
      return
    }
    if (!initial.config.token_configured) {
      showNotice('Isi APIFY_API_TOKEN di file .env terlebih dahulu.', true)
      return
    }
    setCollectModal(true)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNav ? ' sidebar-open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">IB</div>
          <div><strong>IndonesiaBerkumpul</strong><span>Doksli Indonesia.</span></div>
          <button className="icon-button mobile-close" type="button" onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"><X /></button>
        </div>

        <div className="sidebar-heading">
          <span>Topik Mantep</span>
          <button className="icon-button" type="button" onClick={() => setTopicModal(true)} aria-label="Tambah topik"><Plus /></button>
        </div>

        <nav className="topic-list" aria-label="Daftar topik">
          {topics.length ? topics.map((topic) => (
            <div className={`topic-row${topic.id === selectedId ? ' active' : ''}`} key={topic.id}>
              <button
                type="button"
                className="topic-button"
                onClick={() => { setSelectedId(topic.id); setMobileNav(false) }}
              >
                <span><strong>{topic.name}</strong><small>{topic.is_demo ? 'Data contoh' : `${topic.lookback_days} hari terakhir`}</small></span>
                <b>{formatNumber(topic.post_count)}</b>
              </button>
              <button className="topic-archive-button" type="button" onClick={() => setArchiveTarget(topic)} aria-label={`Arsipkan topik ${topic.name}`} title="Arsipkan topik"><Archive /></button>
            </div>
          )) : <p className="sidebar-empty">Belum ada Topik Mantep.</p>}
        </nav>

        <section className={`archive-section${archiveOpen ? ' open' : ''}`}>
          <button className="archive-toggle" type="button" onClick={() => setArchiveOpen((value) => !value)} aria-expanded={archiveOpen}>
            <span><Archive />Arsip</span><b>{formatNumber(archivedTopics.length)}</b>
          </button>
          {archiveOpen && (
            <div className="archive-list">
              {archivedTopics.length ? archivedTopics.map((topic) => (
                <div className="archive-row" key={topic.id}>
                  <div><strong>{topic.name}</strong><small>{formatNumber(topic.post_count)} percakapan</small></div>
                  <button type="button" onClick={() => void handleRestoreTopic(topic)} disabled={submitting} aria-label={`Pulihkan topik ${topic.name}`} title="Pulihkan"><ArrowCounterClockwise /></button>
                  <button className="archive-delete" type="button" onClick={() => setPermanentDeleteTarget(topic)} disabled={submitting} aria-label={`Hapus permanen topik ${topic.name}`} title="Hapus permanen"><Trash /></button>
                </div>
              )) : <p>Belum ada topik yang diarsipkan.</p>}
            </div>
          )}
        </section>

        <div className="connection-panel">
          <span className={`connection-state${initial.config.token_configured ? '' : ' unavailable'}`}>
            <i />{initial.config.token_configured ? 'Apify Udah Nyambung' : 'Mode demo'}
          </span>
          <small>{initial.config.token_configured ? 'Token udah nyambung' : 'Token belum dikonfigurasi'}</small>
          <span className={`connection-state ai${initial.config.gemini_configured ? '' : ' unavailable'}`}>
            <i />{initial.config.gemini_configured ? 'Gemini Udah Nyambung' : 'Gemini belum siap'}
          </span>
          <small>{initial.config.gemini_configured ? initial.config.gemini_model : 'API key belum dikonfigurasi'}</small>
        </div>
      </aside>

      {mobileNav && <button className="sidebar-scrim" type="button" aria-label="Tutup navigasi" onClick={() => setMobileNav(false)} />}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" onClick={() => setMobileNav(true)} aria-label="Buka navigasi"><List /></button>
          <div className="page-identity">
            <span>Doksli Indonesia</span>
            <h1>{selectedTopic?.name ?? 'Ringkasan percakapan'}</h1>
            <p>{selectedTopic?.query ?? 'Buat topik untuk mulai memantau percakapan di X.'}</p>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Ganti tema">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            {selectedTopic && <>
              <button className="secondary-button" type="button" onClick={handleExport}><DownloadSimple />Ekspor CSV</button>
              <button className="secondary-button ai-button" type="button" onClick={openAIAnalysis} disabled={activeAIId === selectedTopic.id}><MagicWand />{activeAIId === selectedTopic.id ? 'Gemini bekerja' : 'Analisis AI'}</button>
              <button className="primary-button" type="button" onClick={openCollection} disabled={Boolean(activeRunId)}><ArrowsClockwise />{activeRunId ? 'Sedang berjalan' : selectedTopic.is_demo ? 'Buat topik nyata' : 'Ambil data'}</button>
            </>}
          </div>
        </header>

        {activeRunId && (
          <div className="run-banner" role="status">
            <span className="run-icon"><ArrowsClockwise /></span>
            <div><strong>Mengambil data dari X</strong><span>Proses berjalan di background. Dashboard diperbarui otomatis.</span></div>
            <div className="run-track"><span /></div>
          </div>
        )}

        {pageError && (
          <div className="inline-alert error" role="alert"><WarningCircle /><span>{pageError}</span></div>
        )}

        {!selectedTopic ? (
          <section className="empty-page">
            <div className="empty-icon"><Broadcast /></div>
            <h2>Belum ada Topik Mantep</h2>
            <p>Buat topik, masukkan query X, lalu mulai pengambilan data melalui Apify.</p>
            <button className="primary-button" type="button" onClick={() => setTopicModal(true)}><Plus />Buat topik</button>
          </section>
        ) : loading && !dashboard ? (
          <DashboardSkeleton />
        ) : dashboard ? (
          <div className="dashboard-content">
            {selectedTopic.is_demo ? (
              <div className="inline-alert"><CheckCircle /><span>Data contoh aktif. Buat topik baru untuk mengambil data nyata dari X.</span></div>
            ) : null}

            <section className="metrics-strip" aria-label="Ringkasan metrik">
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
                  <div><h2>Ringkasan Gemini</h2><p>Intisari percakapan berdasarkan data yang terkumpul.</p></div>
                  <span className={`ai-status ${dashboard.ai_analysis?.status ?? 'idle'}`}><MagicWand />{dashboard.ai_analysis?.status === 'succeeded' ? 'Selesai' : dashboard.ai_analysis?.status === 'failed' ? 'Gagal' : dashboard.ai_analysis?.status === 'queued' || dashboard.ai_analysis?.status === 'running' ? 'Menganalisis' : 'Belum dianalisis'}</span>
                </div>
                {dashboard.ai_analysis?.status === 'succeeded' ? (
                  <div className="ai-summary-content">
                    <p className="ai-summary-lead">{dashboard.ai_analysis.summary}</p>
                    <div className="ai-sentiment-insights">
                      <article className="positive"><span>Sudut positif</span><p>{dashboard.ai_analysis.positive_summary}</p></article>
                      <article className="negative"><span>Sudut negatif</span><p>{dashboard.ai_analysis.negative_summary}</p></article>
                    </div>
                    <div className="ai-topics"><span>Tema utama</span><div>{dashboard.ai_analysis.key_topics.map((topic) => <b key={topic}>{topic}</b>)}</div></div>
                    <small>Dianalisis dengan {dashboard.ai_analysis.model} · {formatDate(dashboard.ai_analysis.analyzed_at, true)}</small>
                  </div>
                ) : dashboard.ai_analysis?.status === 'queued' || dashboard.ai_analysis?.status === 'running' ? (
                  <div className="ai-summary-empty working"><MagicWand /><strong>Gemini sedang membaca percakapan</strong><p>Sentimen dan ringkasan akan muncul otomatis setelah proses selesai.</p></div>
                ) : dashboard.ai_analysis?.status === 'failed' ? (
                  <div className="ai-summary-empty failed"><WarningCircle /><strong>Analisis belum berhasil</strong><p>{dashboard.ai_analysis.error}</p><button className="secondary-button" type="button" onClick={openAIAnalysis}>Coba lagi</button></div>
                ) : (
                  <div className="ai-summary-empty"><MagicWand /><strong>Ubah percakapan menjadi insight</strong><p>Jalankan Gemini untuk menilai sentimen dan merangkum isu utama.</p><button className="secondary-button" type="button" onClick={openAIAnalysis}>Analisis sekarang</button></div>
                )}
              </section>
              <section className="panel sentiment-panel">
                <div className="panel-heading"><div><h2>Sentimen Konoha</h2><p>{dashboard.ai_analysis?.status === 'succeeded' ? 'Klasifikasi konteks, negasi, slang, dan sarkasme oleh Gemini.' : 'Distribusi sementara; jalankan Gemini untuk analisis kontekstual.'}</p></div></div>
                <SentimentChart values={dashboard.sentiment} />
              </section>
            </div>

            <section className="top-conversations-section">
              <div className="section-heading"><div><h2>Percakapan unggulan</h2><p>Konten dengan respons tertinggi berdasarkan metrik publik X.</p></div></div>
              <div className="top-conversation-grid">
                {topConversations.map(({ label, note, post, Icon, value }) => (
                  <article className="top-conversation-card" key={label}>
                    <header><span><Icon />{label}</span><b>{formatNumber(value)}</b></header>
                    {post ? <><p>{post.text}</p><footer><span>@{post.author_username}</span><small>{note}</small><a href={post.url} target="_blank" rel="noreferrer" aria-label={`Buka ${label}`}><ArrowSquareOut /></a></footer></> : <div className="compact-empty">Belum ada data.</div>}
                  </article>
                ))}
              </div>
            </section>

            <div className="insight-grid">
              <section className="panel author-panel">
                <div className="panel-heading"><div><h2>Akun berdampak</h2><p>Diurutkan berdasarkan total interaksi.</p></div></div>
                <div className="author-list">
                  {dashboard.top_authors.length ? dashboard.top_authors.map((author) => (
                    <div className="author-row" key={author.author_username}>
                      <Avatar name={author.author_name} source={author.author_avatar} />
                      <div><strong>{author.author_name}</strong><span>@{author.author_username} · {formatNumber(author.followers)} pengikut</span></div>
                      <b>{formatNumber(author.engagement)}<small>interaksi</small></b>
                    </div>
                  )) : <EmptyCompact text="Belum ada data akun." />}
                </div>
              </section>

              <section className="panel hashtag-panel">
                <div className="panel-heading"><div><h2>Hashtag terkait</h2><p>Tema yang muncul bersama query utama.</p></div></div>
                {dashboard.hashtags.length ? (
                  <div className="hashtag-cloud">{dashboard.hashtags.map((item) => <span key={item.tag}><Hash />{item.tag}<b>{formatNumber(item.count)}</b></span>)}</div>
                ) : <EmptyCompact text="Belum ada hashtag terkait." />}
              </section>

              <section className="panel quality-panel">
                <div className="panel-heading"><div><h2>Kualitas koleksi</h2><p>Ringkasan pengambilan data terakhir.</p></div></div>
                {dashboard.last_run ? (
                  <dl className="run-facts">
                    <div><dt>Status</dt><dd className={`run-status ${dashboard.last_run.status}`}>{runLabels[dashboard.last_run.status]}</dd></div>
                    <div><dt>Waktu</dt><dd>{formatDate(dashboard.last_run.finished_at || dashboard.last_run.requested_at, true)}</dd></div>
                    <div><dt>Diterima</dt><dd>{formatNumber(dashboard.last_run.items_received)} tweet</dd></div>
                    <div><dt>Data baru</dt><dd>{formatNumber(dashboard.last_run.items_new)} tweet</dd></div>
                  </dl>
                ) : <EmptyCompact text="Belum pernah dijalankan." />}
              </section>
            </div>

            <section className="conversation-panel">
              <div className="conversation-header">
                <div><h2>Percakapan terbaru</h2><p>Urut berdasarkan waktu publikasi. Buka sumber untuk memeriksa konteks asli.</p></div>
                <label className="filter-field"><span>Filter sentimen</span><select value={sentimentFilter} onChange={(event) => setSentimentFilter(event.target.value as SentimentFilter)}><option value="all">Semua</option><option value="positive">Positif</option><option value="neutral">Netral</option><option value="negative">Negatif</option></select></label>
              </div>
              <div className="conversation-list">
                {filteredPosts.length ? filteredPosts.map((post) => <ConversationRow key={post.tweet_id} post={post} />) : <EmptyCompact text="Belum ada percakapan pada filter ini." />}
              </div>
            </section>
          </div>
        ) : null}
      </main>

      {notice && <div className={`toast${notice.error ? ' toast-error' : ''}`} role="status">{notice.error ? <WarningCircle /> : <CheckCircle />}<span>{notice.message}</span></div>}

      {topicModal && (
        <Modal title="Topik baru" onClose={() => setTopicModal(false)}>
          <div className="modal-heading"><div><span>Topik baru</span><h2>Apa yang ingin Anda pantau?</h2></div><button className="icon-button" type="button" onClick={() => setTopicModal(false)} aria-label="Tutup"><X /></button></div>
          <form onSubmit={handleCreateTopic}>
            <label className="field"><span>Nama topik</span><input name="name" maxLength={60} required placeholder="Contoh: Pemecatan Purbaya" /><small>Nama singkat untuk navigasi dashboard.</small></label>
            <label className="field"><span>Query pencarian X</span><textarea name="query" maxLength={300} required placeholder={'Contoh: (Purbaya OR "Purbaya Yudhi Sadewa") -filter:retweets'} /><small>Mendukung keyword, frasa, OR, tanda kutip, dan operator pencarian X.</small></label>
            <div className="form-grid">
              <label className="field"><span>Bahasa</span><select name="language" defaultValue="id"><option value="id">Indonesia</option><option value="en">Inggris</option><option value="any">Semua bahasa</option></select></label>
              <label className="field"><span>Rentang waktu</span><select name="lookback_days" defaultValue="1"><option value="1">24 jam</option><option value="7">7 hari</option><option value="14">14 hari</option><option value="30">30 hari</option></select></label>
              <label className="field"><span>Maksimum tweet</span><input type="number" name="max_items" min={20} max={1000} defaultValue={100} required /></label>
            </div>
            {formError && <p className="form-error"><WarningCircle />{formError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setTopicModal(false)}>Batal</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Simpan topik'}</button></div>
          </form>
        </Modal>
      )}

      {collectModal && selectedTopic && (
        <Modal title="Konfirmasi pengambilan data" onClose={() => setCollectModal(false)}>
          <div className="modal-heading"><div><span>Konfirmasi biaya</span><h2>Mulai pengambilan data?</h2></div><button className="icon-button" type="button" onClick={() => setCollectModal(false)} aria-label="Tutup"><X /></button></div>
          <div className="collect-summary">
            <div><span>Topik</span><strong>{selectedTopic.name}</strong></div>
            <div><span>Batas hasil</span><strong>{formatNumber(selectedTopic.max_items)} tweet</strong></div>
            <div><span>Batas biaya</span><strong>US${initial.config.max_charge_usd.toFixed(2)}</strong></div>
          </div>
          <p className="modal-note">Apify dapat mengenakan biaya sesuai hasil yang diterima. Pengambilan data tidak memanggil Gemini; Gemini hanya memakai kuota ketika Anda menekan tombol Analisis AI.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCollectModal(false)}>Batal</button><button className="primary-button" type="button" onClick={handleCollect} disabled={submitting}>{submitting ? 'Menjadwalkan...' : 'Mulai pengambilan'}</button></div>
        </Modal>
      )}

      {aiModal && selectedTopic && dashboard && (
        <Modal title="Konfirmasi analisis Gemini" onClose={() => !submitting && setAiModal(false)}>
          <div className="modal-heading"><div><span>Analisis AI</span><h2>Analisis “{selectedTopic.name}”?</h2></div><button className="icon-button" type="button" onClick={() => setAiModal(false)} aria-label="Tutup" disabled={submitting}><X /></button></div>
          <div className="collect-summary">
            <div><span>Percakapan</span><strong>{formatNumber(dashboard.summary.mentions)} tweet</strong></div>
            <div><span>Model</span><strong>{initial.config.gemini_model}</strong></div>
            <div><span>Hasil</span><strong>Ringkasan Gemini</strong></div>
          </div>
          <p className="modal-note">Maksimal 10 tweet teratas dikirim dalam satu permintaan Gemini untuk dibuat ringkasannya. Proses memakai kuota API Gemini hanya saat Anda memulai analisis, dan hasilnya disimpan.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAiModal(false)} disabled={submitting}>Batal</button><button className="primary-button" type="button" onClick={handleAnalyze} disabled={submitting}><MagicWand />{submitting ? 'Menjadwalkan...' : 'Mulai analisis'}</button></div>
        </Modal>
      )}

      {archiveTarget && (
        <Modal title="Arsipkan topik" onClose={() => !submitting && setArchiveTarget(null)}>
          <div className="modal-heading"><div><span>Arsip topik</span><h2>Arsipkan “{archiveTarget.name}”?</h2></div><button className="icon-button" type="button" onClick={() => setArchiveTarget(null)} aria-label="Tutup" disabled={submitting}><X /></button></div>
          <div className="topic-action-preview"><Archive /><div><strong>{archiveTarget.name}</strong><span>{formatNumber(archiveTarget.post_count)} percakapan tersimpan</span></div></div>
          <p className="modal-note">Topik tidak akan tampil di daftar pantauan, tetapi seluruh data tetap aman dan dapat dipulihkan dari Arsip.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setArchiveTarget(null)} disabled={submitting}>Batal</button><button className="primary-button" type="button" onClick={handleArchiveTopic} disabled={submitting}><Archive />{submitting ? 'Mengarsipkan...' : 'Pindahkan ke Arsip'}</button></div>
        </Modal>
      )}

      {permanentDeleteTarget && (
        <Modal title="Hapus topik permanen" onClose={() => !submitting && setPermanentDeleteTarget(null)}>
          <div className="modal-heading"><div><span>Tindakan permanen</span><h2>Hapus “{permanentDeleteTarget.name}”?</h2></div><button className="icon-button" type="button" onClick={() => setPermanentDeleteTarget(null)} aria-label="Tutup" disabled={submitting}><X /></button></div>
          <div className="topic-action-preview danger"><Trash /><div><strong>{permanentDeleteTarget.name}</strong><span>{formatNumber(permanentDeleteTarget.post_count)} percakapan akan dihapus</span></div></div>
          <p className="modal-note">Seluruh percakapan, hasil analisis, dan riwayat pengambilan data topik ini akan dihapus permanen dan tidak dapat dipulihkan.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPermanentDeleteTarget(null)} disabled={submitting}>Batal</button><button className="danger-button" type="button" onClick={handlePermanentDelete} disabled={submitting}><Trash />{submitting ? 'Menghapus...' : 'Hapus permanen'}</button></div>
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
        <div><strong>{post.author_name}</strong><span>@{post.author_username}</span><small>{formatNumber(post.author_followers)} pengikut</small></div>
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
        <div className="conversation-actions"><a href={post.url} target="_blank" rel="noreferrer">Sumber<ArrowSquareOut /></a></div>
      </div>
    </article>
  )
}

function EmptyCompact({ text }: { text: string }) {
  return <div className="compact-empty">{text}</div>
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Memuat dashboard">
      <div className="skeleton metrics-placeholder" />
      <div className="skeleton chart-placeholder" />
      <div className="skeleton list-placeholder" />
    </div>
  )
}
