import {
  ArrowSquareOut,
  Fire,
  GlobeHemisphereEast,
  Graph,
  Hash,
  Info,
  MapPin,
  Minus,
  SealCheck,
  ShareNetwork,
  TrendDown,
  TrendUp,
  UsersThree,
} from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { formatCount, formatNumber, formatPercent, initials } from '../lib/format'
import type {
  GeoInsights,
  InteractionType,
  NetworkActor,
  NetworkInsights,
  NetworkRole,
  ProvinceRegion,
  SentimentCounts,
} from '../server/api'

const MAP_COLUMNS = 16
const MAP_ROWS = 7

const COMMUNITY_COLORS = ['#4f8ef7', '#2fbf96', '#e9a23b', '#ef6b7a', '#a77bf3', '#33b5d6', '#e07fc0', '#8fbf4d']

export const roleLabels: Record<NetworkRole, string> = {
  influencer: 'Influencer',
  bridge: 'Bridge',
  conversation_driver: 'Conversation Driver',
  amplifier: 'Amplifier',
  referenced: 'Referenced',
  participant: 'Participant',
}

const roleDescriptions: Record<NetworkRole, string> = {
  influencer: 'Highest PageRank: attention flows to this account.',
  bridge: 'High betweenness: links otherwise separate clusters.',
  conversation_driver: 'Draws replies and quotes to its own posts.',
  amplifier: 'Mostly mentions or replies to others.',
  referenced: 'Mentioned by others but posted nothing in this sample.',
  participant: 'Takes part without a dominant network position.',
}

const interactionLabels: Record<InteractionType, string> = {
  reply: 'Replies',
  mention: 'Mentions',
  quote: 'Quotes',
  retweet: 'Reposts',
}

export const sourceLabels: Record<string, string> = {
  place: 'post geotag',
  coordinates: 'profile coordinates (nearest-city estimate)',
  profile: 'profile location',
  flag: 'profile flag',
}

function trendIcon(trend: ProvinceRegion['trend']) {
  if (trend === 'rising') return <TrendUp aria-hidden />
  if (trend === 'cooling') return <TrendDown aria-hidden />
  return <Minus aria-hidden />
}

const trendLabels = { rising: 'Rising', steady: 'Steady', cooling: 'Cooling' } as const

function SentimentBar({ values }: { values: SentimentCounts }) {
  const total = values.positive + values.neutral + values.negative
  if (!total) return <div className="mini-sentiment empty" aria-label="No sentiment data" />
  const label = `Positive ${values.positive}, neutral ${values.neutral}, negative ${values.negative}`
  return (
    <div className="mini-sentiment" role="img" aria-label={label} title={label}>
      {(['positive', 'neutral', 'negative'] as const).map((key) => values[key] ? (
        <span key={key} className={key} style={{ width: `${values[key] / total * 100}%` }} />
      ) : null)}
    </div>
  )
}

function NetSentiment({ value }: { value: number }) {
  const tone = value > 10 ? 'positive' : value < -10 ? 'negative' : 'neutral'
  return <span className={`net-sentiment ${tone}`} title="Net sentiment: positive share minus negative share">{value > 0 ? '+' : ''}{value}</span>
}

function heatStyle(value: number) {
  if (!value) return undefined
  const strength = Math.round(18 + value * 0.72)
  return {
    background: `color-mix(in srgb, var(--heat) ${strength}%, var(--surface-soft))`,
    borderColor: `color-mix(in srgb, var(--heat) ${Math.min(100, strength + 12)}%, var(--line))`,
    color: value >= 55 ? '#fff' : undefined,
  }
}

type GeoMode = 'authors' | 'mentions'

export function GeoPanel({ data }: { data: GeoInsights }) {
  const [mode, setMode] = useState<GeoMode>('authors')
  const valueOf = (province: ProvinceRegion) => mode === 'authors' ? province.posts : province.mentioned_in
  const heatOf = (province: ProvinceRegion) => mode === 'authors' ? province.heat : province.mention_heat
  const ranked = useMemo(
    () => [...data.provinces].filter((province) => valueOf(province) > 0)
      .sort((left, right) => valueOf(right) - valueOf(left) || left.name.localeCompare(right.name)),
    [data, mode],
  )
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const selected = data.provinces.find((province) => province.code === selectedCode) ?? ranked[0] ?? null
  const coverage = data.coverage
  const activeProvinces = ranked.length
  const maxValue = Math.max(1, ...ranked.map(valueOf))
  const sources = Object.entries(coverage.sources)
    .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))
    .map(([key, count]) => `${sourceLabels[key] ?? key} (${formatNumber(count ?? 0)})`)

  return (
    <section className="panel geo-panel" aria-labelledby="geo-heading">
      <div className="panel-heading">
        <div>
          <h2 id="geo-heading">Regional Distribution</h2>
          <p>Where the conversation comes from and which regions it talks about.</p>
        </div>
        <div className="segmented" role="group" aria-label="Region view">
          <button type="button" aria-pressed={mode === 'authors'} onClick={() => setMode('authors')}><MapPin />Author Location</button>
          <button type="button" aria-pressed={mode === 'mentions'} onClick={() => setMode('mentions')}><Hash />Mentioned Regions</button>
        </div>
      </div>

      <div className="geo-coverage">
        <div><span>Posts with a province</span><strong>{formatPercent(coverage.located_share)}</strong><small>{formatNumber(coverage.province)} of {formatCount(coverage.posts, 'post')}</small></div>
        <div><span>Active provinces</span><strong>{formatNumber(activeProvinces)}</strong><small>of 38 provinces</small></div>
        <div><span>Indonesia, no province</span><strong>{formatNumber(coverage.country_only)}</strong><small>Country-level profiles</small></div>
        <div><span>Outside Indonesia</span><strong>{formatNumber(coverage.foreign)}</strong><small>{data.foreign.slice(0, 2).map((row) => row.country).join(', ') || 'None detected'}</small></div>
      </div>

      <div className="geo-layout">
        <div className="geo-map-wrap">
          <div className="geo-map" role="group" aria-label={`Indonesia province heat map by ${mode === 'authors' ? 'author location' : 'regions mentioned in posts'}`}>
            {data.provinces.map((province) => {
              const value = valueOf(province)
              const heat = heatOf(province)
              return (
                <button
                  type="button"
                  key={province.code}
                  className={`geo-tile${province.code === selected?.code ? ' selected' : ''}${value ? '' : ' empty'}`}
                  style={{ gridColumn: province.col + 1, gridRow: province.row + 1, ...heatStyle(heat) }}
                  onClick={() => setSelectedCode(province.code)}
                  aria-label={`${province.name}: ${formatCount(value, 'post')}, heat ${heat}`}
                  aria-pressed={province.code === selected?.code}
                  title={`${province.name} · ${formatCount(value, 'post')}`}
                >
                  <span>{province.code}</span>
                  {value > 0 && <b>{formatNumber(value)}</b>}
                </button>
              )
            })}
          </div>
          <div className="geo-legend" aria-hidden>
            <span>Low</span><i /><span>Hot</span>
            <small>Heat combines post volume (65%) and engagement (35%).</small>
          </div>
        </div>

        <aside className="geo-detail" aria-live="polite">
          {selected && valueOf(selected) > 0 ? (
            <>
              <header>
                <span className="geo-detail-icon" style={heatStyle(heatOf(selected))}><Fire /></span>
                <div><strong>{selected.name}</strong><small>Heat {heatOf(selected)} / 100</small></div>
                {mode === 'authors' && selected.trend && (
                  <span className={`trend-badge ${selected.trend}`}>{trendIcon(selected.trend)}{trendLabels[selected.trend]}</span>
                )}
              </header>
              {mode === 'authors' ? (
                <>
                  <dl className="geo-facts">
                    <div><dt>Posts</dt><dd>{formatNumber(selected.posts)}</dd></div>
                    <div><dt>Authors</dt><dd>{formatNumber(selected.authors)}</dd></div>
                    <div><dt>Observed threads</dt><dd>{formatNumber(selected.threads)}</dd></div>
                    <div><dt>Engagement</dt><dd>{formatNumber(selected.engagement)}</dd></div>
                    <div><dt>Share</dt><dd>{formatPercent(selected.share)}</dd></div>
                    <div><dt>Latest 24h in sample</dt><dd>{formatNumber(selected.recent_posts)}</dd></div>
                    <div><dt>Net sentiment</dt><dd><NetSentiment value={selected.net_sentiment} /></dd></div>
                  </dl>
                  <SentimentBar values={selected.sentiment} />
                  {selected.top_cities.length > 0 && (
                    <div className="geo-tags"><span>Cities</span><div>{selected.top_cities.map((city) => <b key={city.name}>{city.name} · {formatNumber(city.posts)}</b>)}</div></div>
                  )}
                  {selected.top_hashtags.length > 0 && (
                    <div className="geo-tags"><span>Hashtags</span><div>{selected.top_hashtags.map((tag) => <b key={tag}>#{tag}</b>)}</div></div>
                  )}
                  {selected.mentioned_in > 0 && <p className="geo-note">Also mentioned in {formatCount(selected.mentioned_in, 'post')}.</p>}
                </>
              ) : (
                <>
                  <dl className="geo-facts">
                    <div><dt>Posts mentioning</dt><dd>{formatNumber(selected.mentioned_in)}</dd></div>
                    <div><dt>Authors located here</dt><dd>{formatNumber(selected.authors)}</dd></div>
                  </dl>
                  {(() => {
                    const mention = data.mentions.find((row) => row.code === selected.code)
                    return mention ? (
                      <>
                        <dl className="geo-facts">
                          <div><dt>Engagement</dt><dd>{formatNumber(mention.engagement)}</dd></div>
                          <div><dt>Net sentiment</dt><dd><NetSentiment value={mention.net_sentiment} /></dd></div>
                        </dl>
                        {mention.top_cities.length > 0 && <div className="geo-tags"><span>Places named</span><div>{mention.top_cities.map((city) => <b key={city}>{city}</b>)}</div></div>}
                      </>
                    ) : null
                  })()}
                </>
              )}
            </>
          ) : (
            <div className="compact-empty geo-empty"><MapPin /><span>{mode === 'authors' ? 'No posts could be placed in a province yet.' : 'No Indonesian regions are named in collected posts.'}</span></div>
          )}
        </aside>
      </div>

      <div className="geo-lists">
        <div>
          <h3><Fire />{mode === 'authors' ? 'Most Posts by Region' : 'Most Mentioned Regions'}</h3>
          {ranked.length ? (
            <ol className="rank-list">
              {ranked.slice(0, 8).map((province, index) => (
                <li key={province.code}>
                  <button type="button" onClick={() => setSelectedCode(province.code)} aria-label={`Show ${province.name}`} title={`${formatCount(province.posts, 'post')} · ${formatCount(province.threads, 'thread')} observed`}>
                    <span className="rank-index">{index + 1}</span>
                    <span className="rank-name"><strong>{province.name}</strong><i style={{ width: `${valueOf(province) / maxValue * 100}%` }} /></span>
                    <b>{formatNumber(valueOf(province))}</b>
                    {mode === 'authors' && province.trend
                      ? <span className={`trend-badge compact ${province.trend}`} title={trendLabels[province.trend]}>{trendIcon(province.trend)}</span>
                      : <span className="trend-badge compact placeholder" aria-hidden />}
                  </button>
                </li>
              ))}
            </ol>
          ) : <div className="compact-empty">No regions to rank.</div>}
        </div>
        <div>
          <h3><MapPin />{mode === 'authors' ? 'Top Cities' : 'Most Mentioned'}</h3>
          {mode === 'authors' ? (data.cities.length ? (
            <ul className="plain-list">
              {data.cities.slice(0, 8).map((city) => (
                <li key={`${city.province_code}-${city.name}`}><div><strong>{city.name}</strong><small>{city.province}</small></div><NetSentiment value={city.net_sentiment} /><b>{formatNumber(city.posts)}</b></li>
              ))}
            </ul>
          ) : <div className="compact-empty">No city-level locations.</div>) : (data.mentions.length ? (
            <ul className="plain-list">
              {data.mentions.slice(0, 8).map((row) => (
                <li key={row.code}><div><strong>{row.name}</strong><small>{row.top_cities.join(', ') || 'Province named'}</small></div><NetSentiment value={row.net_sentiment} /><b>{formatNumber(row.posts)}</b></li>
              ))}
            </ul>
          ) : <div className="compact-empty">No regions mentioned.</div>)}
        </div>
        <div>
          <h3><GlobeHemisphereEast />Outside Indonesia</h3>
          {data.foreign.length ? (
            <ul className="plain-list">
              {data.foreign.map((row) => <li key={row.country}><div><strong>{row.country}</strong></div><b>{formatNumber(row.posts)}</b></li>)}
            </ul>
          ) : <div className="compact-empty">No foreign locations detected.</div>}
        </div>
      </div>

      <p className="method-note">
        <Info aria-hidden />
        <span>
          Locations come from {sources.join(', ') || 'author profiles'}; {formatNumber(coverage.unknown)} posts had no recognizable location.
          Profiles are self-reported, so treat regions as indicative.
          {' '}Thread IDs are available for {formatCount(coverage.posts_with_thread, 'post')}, covering {formatCount(coverage.threads, 'thread')}. A thread can appear in several regions; replies outside the search are not included.
          {data.trend_window.enabled
            ? ` Trends compare each province's share of the latest ${data.trend_window.recent_hours} hours with its overall share.`
            : ' Trends appear once posts span more than 36 hours.'}
        </span>
      </p>
    </section>
  )
}

function communityColor(community: number | null, order: Map<number, number>) {
  if (community === null) return 'var(--neutral)'
  const index = order.get(community)
  return index === undefined ? 'var(--neutral)' : COMMUNITY_COLORS[index % COMMUNITY_COLORS.length]
}

function ActorAvatar({ actor, color }: { actor: NetworkActor; color?: string }) {
  return (
    <span className="avatar" style={color ? { borderColor: color } : undefined} aria-hidden>
      {actor.avatar ? <img src={actor.avatar} alt="" /> : initials(actor.name)}
    </span>
  )
}

const metricHelp = {
  density: 'Share of possible account-to-account links that exist.',
  reciprocity: 'Share of links returned in the other direction.',
  modularity: 'How strongly accounts split into separate clusters (above 0.3 is notable).',
  centralization: 'How much interaction concentrates on a few accounts (0–1).',
  clustering: 'How often an account’s contacts also interact with each other.',
}

export function NetworkPanel({ data }: { data: NetworkInsights }) {
  const { stats, graph } = data
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const communityOrder = useMemo(
    () => new Map(data.communities.map((community, index) => [community.id, index])),
    [data.communities],
  )
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of graph.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)!.add(edge.target)
      map.get(edge.target)!.add(edge.source)
    }
    return map
  }, [graph.edges])
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes])
  const labelled = useMemo(
    () => new Set([...graph.nodes].sort((left, right) => right.influence - left.influence).slice(0, 10).map((node) => node.id)),
    [graph.nodes],
  )
  const actorsById = useMemo(() => {
    const map = new Map<string, NetworkActor>()
    for (const actor of [...data.actors, ...data.brokers, ...graph.nodes]) map.set(actor.id, actor)
    return map
  }, [data.actors, data.brokers, graph.nodes])
  const focus = hovered ?? selectedId
  const focusNeighbors = focus ? adjacency.get(focus) ?? new Set<string>() : null
  const selected = (selectedId && actorsById.get(selectedId)) || data.actors[0] || null
  const typeTotal = Object.values(stats.interaction_types).reduce((sum, value) => sum + value, 0)
  const width = 1000
  const height = 600

  if (!stats.nodes) {
    return (
      <section className="panel network-panel" aria-labelledby="network-heading">
        <div className="panel-heading"><div><h2 id="network-heading">Social Network Analysis</h2><p>Who interacts with whom through replies, mentions, quotes, and reposts.</p></div></div>
        <div className="compact-empty network-empty"><ShareNetwork /><span>No interactions between accounts in the collected posts yet. Collect more posts or broaden the query.</span></div>
      </section>
    )
  }

  const radius = (influence: number) => 5 + 15 * Math.sqrt(Math.max(0, influence) / 100)

  return (
    <section className="panel network-panel" aria-labelledby="network-heading">
      <div className="panel-heading">
        <div><h2 id="network-heading">Social Network Analysis</h2><p>Who interacts with whom through replies, mentions, quotes, and reposts.</p></div>
        <span className="range-label">{formatCount(stats.nodes, 'account')} · {formatCount(stats.interactions, 'interaction')}</span>
      </div>

      <dl className="network-stats">
        <div><dt>Accounts</dt><dd>{formatNumber(stats.nodes)}</dd><small>{formatNumber(stats.referenced_accounts)} only referenced</small></div>
        <div><dt>Connections</dt><dd>{formatNumber(stats.edges)}</dd><small>Avg. degree {stats.average_degree}</small></div>
        <div><dt>Communities</dt><dd>{formatNumber(stats.communities)}</dd><small>{stats.components} separate groups</small></div>
        <div title={metricHelp.modularity}><dt>Modularity</dt><dd>{stats.modularity.toFixed(2)}</dd><small>{stats.modularity >= 0.3 ? 'Clearly clustered' : 'Weak clustering'}</small></div>
        <div title={metricHelp.density}><dt>Density</dt><dd>{formatPercent(stats.density, 2)}</dd><small>Possible links present</small></div>
        <div title={metricHelp.reciprocity}><dt>Reciprocity</dt><dd>{formatPercent(stats.reciprocity)}</dd><small>Two-way links</small></div>
        <div title={metricHelp.centralization}><dt>Centralization</dt><dd>{stats.centralization.toFixed(2)}</dd><small>{stats.centralization >= 0.3 ? 'Few dominant hubs' : 'Spread out'}</small></div>
        <div><dt>Unconnected authors</dt><dd>{formatNumber(stats.isolated_authors)}</dd><small>of {formatNumber(stats.authors)} authors</small></div>
      </dl>

      <div className="network-layout">
        <div className="network-graph-wrap">
          <svg
            className="network-graph"
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label={`Interaction graph of ${graph.nodes.length} accounts. Use the Key Actors table for an accessible list.`}
            onMouseLeave={() => setHovered(null)}
          >
            <g className="edges">
              {graph.edges.map((edge) => {
                const source = nodesById.get(edge.source)
                const target = nodesById.get(edge.target)
                if (!source || !target) return null
                const active = focus ? edge.source === focus || edge.target === focus : false
                return (
                  <line
                    key={`${edge.source}-${edge.target}`}
                    x1={source.x * width}
                    y1={source.y * height}
                    x2={target.x * width}
                    y2={target.y * height}
                    className={`edge ${edge.type}${active ? ' active' : ''}${focus && !active ? ' dim' : ''}`}
                    strokeWidth={Math.min(5, 0.9 + Math.log1p(edge.weight) * 1.2)}
                  />
                )
              })}
            </g>
            <g className="nodes">
              {graph.nodes.map((node) => {
                const r = radius(node.influence)
                const isFocus = node.id === focus
                const dim = focus && !isFocus && !focusNeighbors?.has(node.id)
                const showLabel = labelled.has(node.id) || isFocus || focusNeighbors?.has(node.id)
                const color = communityColor(node.community, communityOrder)
                return (
                  <g
                    key={node.id}
                    className={`node${dim ? ' dim' : ''}${node.id === selectedId ? ' selected' : ''}`}
                    transform={`translate(${node.x * width} ${node.y * height})`}
                    tabIndex={0}
                    role="button"
                    aria-label={`@${node.username}, ${roleLabels[node.role]}, influence ${node.influence}`}
                    onMouseEnter={() => setHovered(node.id)}
                    onFocus={() => setHovered(node.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setSelectedId(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(node.id)
                      }
                    }}
                  >
                    <circle r={r + 3} className="halo" style={{ stroke: color }} />
                    <circle r={r} style={{ fill: color }} className={node.posts ? '' : 'referenced'} />
                    {showLabel && <text y={-r - 6} textAnchor="middle">@{node.username}</text>}
                  </g>
                )
              })}
            </g>
          </svg>
          <div className="network-legend">
            {data.communities.slice(0, 8).map((community, index) => (
              <span key={community.id}><i style={{ background: COMMUNITY_COLORS[index % COMMUNITY_COLORS.length] }} />{community.label}</span>
            ))}
            <span className="edge-key reply">Reply</span>
            <span className="edge-key mention">Mention</span>
            <span className="edge-key quote">Quote</span>
            <span className="edge-key retweet">Repost</span>
          </div>
          {graph.truncated && <p className="graph-note">Showing {graph.nodes.length} of {formatNumber(stats.nodes)} accounts, keeping whole clusters from the largest down.</p>}
        </div>

        {selected && (
          <aside className="actor-detail" aria-live="polite">
            <header>
              <ActorAvatar actor={selected} color={communityColor(selected.community, communityOrder)} />
              <div>
                <strong>{selected.name}{selected.verified && <SealCheck className="verified" aria-label="Verified" />}</strong>
                <a href={`https://x.com/${encodeURIComponent(selected.username)}`} target="_blank" rel="noreferrer">@{selected.username}<ArrowSquareOut /></a>
              </div>
            </header>
            <span className={`role-badge ${selected.role}`} title={roleDescriptions[selected.role]}>{roleLabels[selected.role]}</span>
            <p className="role-copy">{roleDescriptions[selected.role]}</p>
            <dl className="geo-facts">
              <div><dt>Influence</dt><dd>{selected.influence}</dd></div>
              <div><dt>Betweenness</dt><dd>{selected.betweenness.toFixed(3)}</dd></div>
              <div><dt>Reached by</dt><dd>{formatNumber(selected.in_degree)}</dd></div>
              <div><dt>Reaches</dt><dd>{formatNumber(selected.out_degree)}</dd></div>
              <div><dt>Posts</dt><dd>{formatNumber(selected.posts)}</dd></div>
              <div><dt>Followers</dt><dd>{formatNumber(selected.followers)}</dd></div>
            </dl>
            <div className="received-list">
              {(Object.keys(interactionLabels) as InteractionType[]).map((type) => (
                <span key={type} className={type}><b>{formatNumber(selected.received[type])}</b>{interactionLabels[type]} received</span>
              ))}
            </div>
            {selected.location && <p className="geo-note"><MapPin aria-hidden />{selected.location}</p>}
          </aside>
        )}
      </div>

      <div className="network-sections">
        <div className="actors-table-wrap">
          <h3><UsersThree />Key Actors</h3>
          <table className="actors-table">
            <thead>
              <tr><th scope="col">#</th><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Influence</th><th scope="col" title="Accounts that interacted with this account">In</th><th scope="col" title="Accounts this account interacted with">Out</th><th scope="col">Region</th></tr>
            </thead>
            <tbody>
              {data.actors.slice(0, 12).map((actor, index) => (
                <tr key={actor.id} className={actor.id === selected?.id ? 'selected' : ''}>
                  <td>{index + 1}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedId(actor.id)} onMouseEnter={() => setHovered(actor.id)} onMouseLeave={() => setHovered(null)}>
                      <ActorAvatar actor={actor} color={communityColor(actor.community, communityOrder)} />
                      <span><strong>{actor.name}</strong><small>@{actor.username}</small></span>
                    </button>
                  </td>
                  <td><span className={`role-badge ${actor.role}`} title={roleDescriptions[actor.role]}>{roleLabels[actor.role]}</span></td>
                  <td><span className="influence-bar"><i style={{ width: `${actor.influence}%` }} /><b>{actor.influence.toFixed(0)}</b></span></td>
                  <td>{formatNumber(actor.in_degree)}</td>
                  <td>{formatNumber(actor.out_degree)}</td>
                  <td className="region-cell">{actor.location ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="network-side">
          <div>
            <h3><Graph />Interaction Types</h3>
            <div className="type-bars">
              {(Object.keys(interactionLabels) as InteractionType[]).map((type) => (
                <div key={type}>
                  <span>{interactionLabels[type]}</span>
                  <span className="type-track"><i className={type} style={{ width: `${typeTotal ? stats.interaction_types[type] / typeTotal * 100 : 0}%` }} /></span>
                  <b>{formatNumber(stats.interaction_types[type])}</b>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3><ShareNetwork />Bridges Between Clusters</h3>
            {data.brokers.length ? (
              <ul className="plain-list">
                {data.brokers.slice(0, 5).map((actor) => (
                  <li key={actor.id}><button type="button" onClick={() => setSelectedId(actor.id)}><strong>@{actor.username}</strong><small>{roleLabels[actor.role]}</small></button><b>{actor.betweenness.toFixed(3)}</b></li>
                ))}
              </ul>
            ) : <div className="compact-empty">No accounts connect separate clusters.</div>}
          </div>
          <div>
            <h3><UsersThree />Role Mix</h3>
            <div className="role-mix">
              {(Object.keys(roleLabels) as NetworkRole[]).filter((role) => stats.roles[role]).map((role) => (
                <span key={role} className={`role-badge ${role}`} title={roleDescriptions[role]}>{roleLabels[role]} <b>{formatNumber(stats.roles[role] ?? 0)}</b></span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {data.communities.length > 0 && (
        <div className="community-section">
          <h3><Graph />Communities</h3>
          <div className="community-grid">
            {data.communities.map((community, index) => (
              <article key={community.id} className="community-card" style={{ borderTopColor: COMMUNITY_COLORS[index % COMMUNITY_COLORS.length] }}>
                <header><strong>{community.label}</strong><b>{formatCount(community.size, 'account')}</b></header>
                <small>{formatPercent(community.share)} of network · {formatCount(community.internal_interactions, 'interaction')} inside</small>
                <div className="community-members">
                  {community.top_members.slice(0, 4).map((member) => (
                    <button type="button" key={member.username} onClick={() => setSelectedId(member.username.toLowerCase())}>@{member.username}</button>
                  ))}
                </div>
                {community.top_hashtags.length > 0 && <div className="community-tags">{community.top_hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
                <SentimentBar values={community.sentiment} />
                {community.top_region && <p className="geo-note"><MapPin aria-hidden />Mostly {community.top_region}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="network-sections two">
        <div>
          <h3><ShareNetwork />Strongest Ties</h3>
          {data.strongest_ties.length ? (
            <ul className="plain-list ties">
              {data.strongest_ties.slice(0, 6).map((tie) => (
                <li key={`${tie.source}-${tie.target}`}>
                  <div><strong>@{tie.source} → @{tie.target}</strong><small>{Object.entries(tie.types).map(([type, count]) => `${count} ${interactionLabels[type as InteractionType].toLowerCase()}`).join(' · ')}</small></div>
                  <b>{formatNumber(tie.count)}</b>
                </li>
              ))}
            </ul>
          ) : <div className="compact-empty">No repeated ties.</div>}
        </div>
        <div>
          <h3><Hash />Hashtags Used Together</h3>
          {data.hashtag_pairs.length ? (
            <ul className="plain-list">
              {data.hashtag_pairs.slice(0, 6).map((pair) => (
                <li key={pair.tags.join('+')}><div><strong>#{pair.tags[0]} + #{pair.tags[1]}</strong></div><b>{formatNumber(pair.count)}</b></li>
              ))}
            </ul>
          ) : <div className="compact-empty">No hashtag pairs appear more than once.</div>}
        </div>
      </div>

      <p className="method-note">
        <Info aria-hidden />
        <span>
          Influence is PageRank scaled to the top account (100). Bridges have the highest betweenness centrality{stats.betweenness_sampled ? ' (estimated from a sample of accounts)' : ''}.
          Communities use Louvain clustering. Only interactions visible in collected posts are included, not follower relationships.
        </span>
      </p>
    </section>
  )
}

export function InsightsSkeleton() {
  return (
    <div className="insights-skeleton" aria-label="Loading regional and network insights">
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  )
}
