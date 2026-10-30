import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { fetchStickerAnimation, isLottieStickerUrl } from './lottieSticker.js';

const paths = {
  archive: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 13h6M9 16h4"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  hash: <><path d="M10 3 7 21M17 3l-3 18M4 9h17M3 15h17"/></>,
  chart: <><path d="M4 20V11m6 9V5m6 15v-8m4 8V8M2 20h20"/></>,
  sliders: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="2" fill="currentColor" stroke="none"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
  external: <><path d="M13 5h6v6M19 5l-9 9"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
  logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M9 12h10"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  close: <><path d="M5 5l14 14M19 5 5 19"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.8 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.2-2"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
  shield: <><path d="M12 2 4 5v6c0 5.1 3.4 8.5 8 11 4.6-2.5 8-5.9 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></>,
  spark: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2ZM19 17l.8 1.2L21 19l-1.2.8L19 21l-.8-1.2L17 19l1.2-.8L19 17Z"/></>,
  inbox: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h5l2 3h4l2-3h5"/></>,
};
function Icon({ name, size = 18, className = '' }) { return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
function Logo() { return <strong className="brand">ArchiveMe</strong>; }
function Avatar({ src, name, size = 'normal' }) { const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [src]); return <span className={`avatar avatar-${size}`} aria-label={name || 'User'}>{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)}/> : <span>{(name || '?').trim().slice(0, 2).toUpperCase()}</span>}</span>; }
function getAvatar(user) { return user?.avatar ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=80` : null; }
function formatNumber(n) { return Number(n || 0).toLocaleString(); }
function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, options).format(d); }
function formatTime(value) { return formatDate(value, { hour: 'numeric', minute: '2-digit' }); }
function sameDay(a, b) { return a && b && new Date(a).toDateString() === new Date(b).toDateString(); }
async function api(path, options = {}) { const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); let data = null; try { data = await response.json(); } catch { /* non-JSON errors are still surfaced */ } if (!response.ok) { const detail = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : `Request failed (${response.status})`; const error = new Error(detail); error.status = response.status; throw error; } return data; }
function readableError(error) { return error?.message || 'Something went wrong. Please try again.'; }
function Login({ error }) {
  const [installUrl, setInstallUrl] = useState(null);
  useEffect(() => {
    let active = true;
    api('/api/public-config').then(config => {
      if (active && typeof config?.installUrl === 'string' && config.installUrl.startsWith('https://discord.com/oauth2/authorize?'))
        setInstallUrl(config.installUrl);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <main className="login-layout">
    <section className="login-panel">
      <div className="login-top"><Logo/></div>
      <div className="login-content">
        <h1>ArchiveMe</h1>
        <div className="login-actions">
          <a className="primary-button login-button" href="/auth/discord">Continue with Discord</a>
          {installUrl ? <a className="secondary-button bot-install-button" href={installUrl} target="_blank" rel="noopener noreferrer">Add bot to your server</a>
            : <span className="bot-install-unavailable">Bot invite unavailable while offline.</span>}
        </div>
        <p className="bot-install-note">Installing the bot does not start archiving. Channels stay off until enabled. Dashboard available only on this computer.</p>
        {error && <div className="inline-alert login-error" role="alert">{error}</div>}
      </div>
    </section>
  </main>;
}
function StatePanel({ icon = 'inbox', title, description, action, compact = false }) { return <div className={`state-panel ${compact ? 'state-panel-compact' : ''}`}><div className="state-icon"><Icon name={icon} size={25}/></div><h3>{title}</h3><p>{description}</p>{action}</div>; }
function LoadingBlock({ lines = 3 }) { return <div className="loading-block" aria-label="Loading" role="status">{Array.from({length: lines}, (_, i) => <div key={i} className={`skeleton skeleton-${i % 3}`}/>)}</div>; }
function Sidebar({ guilds, guild, setGuildId, view, setView, setArchiveChannelId, open, close, user, onLogout, loggingOut }) { return <><div className={`sidebar-scrim ${open ? 'visible' : ''}`} onClick={close} aria-hidden="true"/><aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label="Main navigation"><div className="sidebar-brand"><Logo/><button className="icon-button sidebar-close" onClick={close} aria-label="Close navigation"><Icon name="close"/></button></div><div className="sidebar-scroll"><div className="guild-picker-wrap"><label htmlFor="guild-select" className="sr-only">Select community</label><div className="guild-picker"><span className="guild-badge">{guild?.icon ? <img src={`https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=80`} alt=""/> : (guild?.name || '?').slice(0, 1).toUpperCase()}</span><span className="guild-picker-text"><strong>{guild?.name || 'Choose a server'}</strong></span><Icon name="down" size={16}/><select id="guild-select" value={guild?.id || ''} onChange={e => { setGuildId(e.target.value); close(); }} aria-label="Select community">{guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div></div><div className="nav-section"><button className={`nav-item ${view === 'archive' ? 'active' : ''}`} onClick={() => { setArchiveChannelId(''); setView('archive'); close(); }}><Icon name="archive" size={18}/> Server archive</button><button className={`nav-item ${view === 'statistics' ? 'active' : ''}`} onClick={() => { setView('statistics'); close(); }}><Icon name="chart" size={18}/> Statistics</button><button className={`nav-item ${view === 'media' ? 'active' : ''}`} onClick={() => { setView('media'); close(); }}><Icon name="inbox" size={18}/> Media & emotes</button><button className={`nav-item ${view === 'members' ? 'active' : ''}`} onClick={() => { setView('members'); close(); }}><Icon name="grid" size={18}/> Members</button><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); close(); }}><Icon name="sliders" size={18}/> Channel settings</button></div></div><div className="sidebar-bottom"><div className="sidebar-profile"><Avatar src={getAvatar(user)} name={user?.username} size="small"/><div className="profile-text"><strong>{user?.username || 'Admin'}</strong></div><button className="icon-button logout-button" onClick={onLogout} disabled={loggingOut} aria-label="Sign out" title="Sign out"><Icon name="logout" size={18}/></button></div></div></aside></>; }
function Chart({ daily = [], days }) { const ordered = [...daily].sort((a, b) => String(a.date).localeCompare(String(b.date))); const max = Math.max(1, ...ordered.map(d => Number(d.count) || 0)); if (!ordered.length) return <StatePanel compact icon="chart" title="No activity to chart" description="Activity will appear here once messages are archived for this channel."/>; const width = 700, height = 180, pad = 5; const points = ordered.map((d, i) => `${pad + (i / Math.max(1, ordered.length - 1)) * (width - pad * 2)},${height - 16 - ((Number(d.count) || 0) / max) * 142}`).join(' '); return <div className="chart-wrap"><div className="chart-scale"><span>{formatNumber(max)}</span><span>{formatNumber(Math.round(max / 2))}</span><span>0</span></div><div className="chart-body"><div className="chart-grid"><span/><span/><span/></div><svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Message activity over ${days} days; ${ordered.map(d => `${formatDate(d.date)}: ${d.count}`).join(', ')}`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>{ordered.length === 1 && <circle cx={pad} cy={height - 16 - ((Number(ordered[0].count) || 0) / max) * 142} r="4" fill="currentColor"/>}</svg><div className="chart-labels"><span>{formatDate(ordered[0].date, {month:'short',day:'numeric'})}</span><span>{formatDate(ordered[Math.floor((ordered.length - 1)/2)].date, {month:'short',day:'numeric'})}</span><span>{formatDate(ordered[ordered.length - 1].date, {month:'short',day:'numeric'})}</span></div></div></div>; }
// Defense in depth for links and image previews: accept only HTTPS Discord CDN URLs.
function isSafeMediaLink(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
      && !url.username && !url.password && !url.port;
  } catch { return false; }
}
function isSafePreviewUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.discordapp.com' && !url.username && !url.password && !url.port
      && /^\/(?:emojis|stickers)\/\d{16,22}\.(?:png|gif)$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}
function LottieSticker({ url, name, onFailure }) {
  const container = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!container.current || !isLottieStickerUrl(url)) return;
    const controller = new AbortController();
    let animation;
    const element = container.current;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) { animation?.pause(); return; }
      observer.disconnect();
      (async () => {
        try {
          const data = await fetchStickerAnimation(url, controller.signal);
          if (controller.signal.aborted) return;
          const { default: player } = await import('lottie-web/build/player/lottie_light_canvas.min.js');
          if (controller.signal.aborted) return;
          animation = player.loadAnimation({ container: element, renderer: 'canvas', loop: true,
            autoplay: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, animationData: data });
          animation.addEventListener('data_failed', () => { setFailed(true); onFailure?.(); });
        } catch { if (!controller.signal.aborted) { setFailed(true); onFailure?.(); } }
      })();
    });
    observer.observe(element);
    return () => { observer.disconnect(); controller.abort(); animation?.destroy(); };
  }, [url, onFailure]);
  if (failed) return null;
  return <span className="media-preview lottie-preview" ref={container} role="img" aria-label={name || 'Animated sticker'}/>;
}
function EmotePreview({ item, onFailure }) {
  if (item?.kind === 'sticker' && isLottieStickerUrl(item.url)) return <LottieSticker url={item.url} name={item.name} onFailure={onFailure}/>;
  if (item?.url && isSafePreviewUrl(item.url)) return <img className="media-preview" src={item.url} alt={item.name || 'Sticker or emote'} loading="lazy" referrerPolicy="no-referrer"/>;
  if (item?.kind === 'emoji' && !/^\d{16,22}$/.test(String(item.id))) return <span className="media-preview" role="img" aria-label={item.name || 'Emote'}>{item.name}</span>;
  return null;
}
function ChannelSelect({ channels, channelId, setChannelId, id }) {
  return <label className="select-wrap"><span>Select channel</span><select id={id} value={channelId} onChange={event => setChannelId(event.target.value)} disabled={!channels.length}>
    {!channels.length && <option value="">No channels available</option>}
    {channels.map(item => <option key={item.id} value={item.id}>#{item.name}{item.enabled ? '' : ' (disabled)'}</option>)}
  </select></label>;
}
function ColumnChart({ rows, label }) {
  const max = Math.max(1, ...rows.map(row => Number(row.count) || 0));
  return <div className="column-chart" role="group" aria-label={label}>
    {rows.map(row => <div className="column-item" key={row.key}>
      {row.preview && <span className="column-preview-slot"><EmotePreview item={row.preview}/></span>}
      <strong className="column-value">{formatNumber(row.count)}</strong>
      <div className="column-track" role="img" aria-label={`${row.label}: ${formatNumber(row.count)}`}>
        <span className="column-fill" style={{ height: `${Math.max(0, Math.min(100, (Number(row.count) || 0) / max * 100))}%` }}/>
      </div>
      <span className="column-label" title={row.label}>{row.label}</span>
    </div>)}
  </div>;
}
function Statistics({ guild, channels, channel, setChannelId, stats, loading, error, days, setDays, retry }) {
  const hourly = stats?.hourly || [];
  const categories = stats?.categories || {};
  const labels = { text: 'Text', images: 'Images', videos: 'Videos', links: 'Links', other: 'Other', unknown: 'Older / unclassified' };
  const topEmojis = stats?.topEmojis || [];
  const topStickers = stats?.topStickers || [];
  return <div className="page-content statistics-page">
    <div className="heading-row"><div><h1>Statistics</h1></div></div>
    <div className="statistics-filters card"><ChannelSelect channels={channels} channelId={channel?.id || ''} setChannelId={setChannelId} id="statistics-channel"/>
      <label className="select-wrap"><span>Time range</span><select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
    </div>
    {!channel ? <StatePanel icon="hash" title="Choose a channel" description="Select a channel above to see statistics."/> : !channel.enabled ? <StatePanel icon="lock" title="Channel not enabled" description="Enable this channel in settings to see its statistics."/> : loading ? <LoadingBlock lines={5}/> : error ? <StatePanel icon="info" title="Couldn’t load statistics" description={error} action={<button className="text-button" onClick={retry}>Try again</button>}/> : <>
      <section className="card activity-card"><h2>Messages over time</h2><p>{formatNumber(stats?.total)} messages in the last {days} days.</p><Chart daily={stats?.daily} days={days}/></section>
      <section className="card"><h2>Most active hours</h2><p>Hours are shown in UTC. Counts include archived messages in the selected period, not times the bot was offline.</p>
        <ColumnChart label="Messages by hour UTC" rows={hourly.map(({ hour, count }) => ({ key: hour, label: `${String(hour).padStart(2, '0')}:00`, count }))}/>
      </section>
      <section className="card"><h2>What messages contain</h2><p>One bar per message: a video counts as Video; otherwise an image, link, text, or Other. Older messages may be unclassified.</p>
        <ColumnChart label="Archived messages by content type" rows={Object.entries(labels).map(([key, label]) => ({ key, label, count: Number(categories[key]) || 0 }))}/>
      </section>
      <section className="card"><h2>Most-used emotes</h2><p>Uses in archived messages during the selected period.</p>
        {topEmojis.length ? <ColumnChart label="Most-used emotes" rows={topEmojis.map(item => ({ key: item.id, label: item.name, count: item.count, preview: { ...item, kind: 'emoji' } }))}/> : <p>No recorded emotes in this period.</p>}
      </section>
      <section className="card"><h2>Most-used stickers</h2><p>Uses in archived messages during the selected period.</p>
        {topStickers.length ? <ColumnChart label="Most-used stickers" rows={topStickers.map(item => ({ key: item.id, label: item.name, count: item.count, preview: { ...item, kind: 'sticker' } }))}/> : <p>No recorded stickers in this period.</p>}
      </section>
    </>}
  </div>;
}
function MediaItem({ item }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const lottie = item.kind === 'sticker' && isLottieStickerUrl(item.url);
  return <article className="card media-item">
    {(item.kind === 'emoji' || item.kind === 'sticker') && <EmotePreview item={item} onFailure={setPreviewFailed}/>}
    <div className="media-meta"><strong>{item.name || (item.kind === 'sticker' ? 'Sticker' : item.kind === 'emoji' ? 'Emote' : 'Attachment')}</strong><span>{item.kind === 'sticker' ? 'Sticker' : item.kind === 'emoji' ? 'Emote' : item.contentType || 'Attachment'}</span>{item.count > 1 && <span>{formatNumber(item.count)} uses in this message</span>}{item.size != null && <span>{formatNumber(item.size)} bytes</span>}<span>{item.authorName || 'Unknown member'} · {formatDate(item.createdAt)}</span></div>
    {item.url && (isSafeMediaLink(item.url) || lottie) ? <a href={item.url} target="_blank" rel="noopener noreferrer">Open on Discord <Icon name="external" size={15}/></a> : null}
    {item.kind === 'sticker' && (!item.url || previewFailed) && <span>Sticker preview unavailable</span>}
  </article>;
}
function Media({ guild, channels, channel, setChannelId, items, loading, loadingMore, nextBefore, error, loadMore, retry }) {
  return <div className="page-content media-page"><div className="heading-row"><div><h1>Media, stickers &amp; emotes</h1></div></div>
    <div className="statistics-filters card"><ChannelSelect channels={channels} channelId={channel?.id || ''} setChannelId={setChannelId} id="media-channel"/></div>
    <p>Stickers and emotes appear here when archived after this feature was enabled. Images load from Discord when available; ArchiveMe does not keep copies. External links may expire. Animated stickers play when visible, unless reduced motion is enabled.</p>
    {!channel ? <StatePanel icon="hash" title="Choose a channel" description="Select a channel above to see its media."/> : !channel.enabled ? <StatePanel icon="lock" title="Channel not enabled" description="Enable this channel in settings to see its media."/> : loading ? <LoadingBlock lines={5}/> : error && !items.length ? <StatePanel icon="info" title="Couldn’t load media" description={error} action={<button className="text-button" onClick={retry}>Try again</button>}/> : !items.length ? <StatePanel icon="inbox" title="No archived media" description="Files, stickers, and emotes from new opted-in messages will show up here."/> : <>
      <div className="media-grid">{items.map((item, index) => <MediaItem item={item} key={`${item.messageId}-${item.kind}-${item.id}-${index}`}/>)}</div>
      {(nextBefore || loadingMore || error) && <div className="load-footer">{error && <p role="alert">{error}</p>}<button className="secondary-button" onClick={loadMore} disabled={loadingMore || !nextBefore}>{loadingMore ? 'Loading…' : 'Load older media'}</button></div>}
    </>}
  </div>;
}
function ArchiveMedia({ item }) {
  const [failed, setFailed] = useState(false);
  const image = item.kind === 'attachment' && item.contentType?.toLowerCase().startsWith('image/') && isSafeMediaLink(item.url);
  const video = item.kind === 'attachment' && item.contentType?.toLowerCase().startsWith('video/') && isSafeMediaLink(item.url);
  const link = item.url && (isSafeMediaLink(item.url) || (item.kind === 'sticker' && isLottieStickerUrl(item.url)));
  return <div className="archive-media-item">
    {item.kind === 'sticker' || item.kind === 'emoji' ? <EmotePreview item={item} onFailure={() => setFailed(true)}/> :
      image && !failed ? <img className="archive-attachment-preview" src={item.url} alt={item.name || 'Attached image'} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> :
      video && !failed ? <video className="archive-attachment-preview" controls preload="none" src={item.url} aria-label={item.name || 'Attached video'} onError={() => setFailed(true)}/> : null}
    <span>{item.name || (item.kind === 'sticker' ? 'Sticker' : item.kind === 'emoji' ? 'Emote' : 'Attachment')}{item.count > 1 ? ` (${formatNumber(item.count)} uses)` : ''}</span>
    {link && <a href={item.url} target="_blank" rel="noopener noreferrer">Open on Discord</a>}
    {failed && <span>Preview unavailable</span>}
  </div>;
}
function MessageRow({ message, showDate, showChannel = false }) {
  const name = message.authorName || 'Unknown member';
  const deleted = Boolean(message.deletedAt);
  const media = Array.isArray(message.media) ? message.media : [];
  return <React.Fragment>
    {showDate && <div className="date-divider"><span>{formatDate(message.createdAt, {weekday:'long',month:'long',day:'numeric',year:'numeric'})}</span></div>}
    <article className={`message ${deleted ? 'message-deleted' : ''}`}><Avatar src={message.avatarUrl} name={name}/><div className="message-main">
      <div className="message-meta">{showChannel && <span>#{message.channelName || 'Unknown channel'}</span>}<strong>{name}</strong><span>UID: {message.authorId || 'Unknown'}</span><time dateTime={message.createdAt || undefined} title={formatDate(message.createdAt, {dateStyle:'full',timeStyle:'short'})}>{formatTime(message.createdAt)}</time>{message.editedAt && <span className="edited-label">edited</span>}</div>
      {deleted ? <div className="message-content"><em>Message deleted</em></div> : <>
        {message.content && <div className="message-content">{message.content}</div>}
        {media.length > 0 && <div className="archive-media" aria-label="Message media">{media.map(item => <ArchiveMedia key={`${item.kind}-${item.id}`} item={item}/>)}</div>}
        {!message.content && !media.length && <div className="message-content"><em>No text or media recorded</em></div>}
      </>}
    </div></article>
  </React.Fragment>;
}
function Archive({ channels, channelId, setChannelId, messages, loading, loadingMore, nextBefore, error, search, setSearch, loadMore, retry }) {
  const filtered = useMemo(() => messages.filter(message => `${message.channelName || ''} ${message.authorName || ''} ${message.authorId || ''} ${message.content || ''} ${(message.media || []).map(item => item.name || '').join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [messages, search]);
  const available = channels.some(channel => channel.enabled);
  return <div className="page-content archive-page">
    <h1>Server archive</h1>
    <div className="archive-tools"><label htmlFor="archive-channel">Channel</label>
      <select id="archive-channel" value={channelId} onChange={event => setChannelId(event.target.value)}>
        <option value="">All enabled channels</option>
        {channels.filter(channel => channel.enabled).map(channel => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
      </select>
      <label htmlFor="message-search">Search loaded messages</label>
      <input id="message-search" type="search" placeholder="Search messages already loaded" value={search} onChange={event => setSearch(event.target.value)}/>
      {search && <button type="button" onClick={() => setSearch('')}>Clear</button>}
    </div>
    <p>Only enabled channels you can currently read. Search checks loaded messages, not the full archive. Reopen Server archive to check for new messages.</p>
    <div className="message-list" aria-live="polite">
      {!available ? <StatePanel title="No enabled channels" description="Enable a channel in settings to start archiving new messages."/> :
        loading ? <LoadingBlock lines={6}/> :
        error && !messages.length ? <StatePanel title="Couldn’t load messages" description={error} action={<button onClick={retry}>Try again</button>}/> :
        !messages.length ? <StatePanel title="No archived messages" description="New messages in enabled channels will appear here."/> :
        filtered.length ? filtered.map((message, index) => <MessageRow key={message.id} message={message} showChannel={!channelId} showDate={index === 0 || !sameDay(filtered[index - 1]?.createdAt, message.createdAt)}/>) :
        <StatePanel title="No matches in loaded messages" description="Try another term or load older messages."/>}
    </div>
    {!loading && (nextBefore || loadingMore || (error && messages.length > 0)) && <div className="load-footer">
      {error && messages.length > 0 && <p role="alert">{error}</p>}
      <button type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older messages'}</button>
    </div>}
  </div>;
}
function Members({ guildId, onUnauthorized }) {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const requestVersion = useRef(0);
  const currentGuild = useRef(guildId);
  currentGuild.current = guildId;
  useEffect(() => { requestVersion.current++; setQuery(''); setMembers([]); setError(''); setSearched(false); setLoading(false); return () => { requestVersion.current++; }; }, [guildId]);
  async function search(event) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 3 || value.length > 100) { setError('Enter at least 3 characters, or a full Discord UID.'); return; }
    const version = ++requestVersion.current;
    const requestedGuild = guildId;
    setLoading(true); setError(''); setMembers([]); setSearched(true);
    try {
      const result = await api(`/api/guilds/${encodeURIComponent(requestedGuild)}/members?query=${encodeURIComponent(value)}&limit=25`);
      if (version === requestVersion.current && requestedGuild === currentGuild.current) setMembers(Array.isArray(result?.members) ? result.members : []);
    } catch (err) { if (version === requestVersion.current && requestedGuild === currentGuild.current) { if (err.status === 401) onUnauthorized(); else setError(readableError(err)); } }
    finally { if (version === requestVersion.current && requestedGuild === currentGuild.current) setLoading(false); }
  }
  return <div className="page-content members-page"><div className="heading-row"><h1>Members</h1></div>
    <p>Search current server members by full UID or the beginning of their display name or Discord username. Results come from Discord; ArchiveMe does not archive a member directory.</p>
    <form className="member-search" onSubmit={search}><label htmlFor="member-query">Member UID or name</label>
      <input id="member-query" type="search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="Enter UID or at least 3 letters"/>
      <button className="primary-button" type="submit" disabled={loading || !guildId}>{loading ? 'Searching…' : 'Search'}</button></form>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {!loading && searched && !error && !members.length && <p>No matching members found.</p>}
    <div className="members-list">{members.map(member => <article className="member-entry" key={member.uid}>
      <h2>{member.displayName || member.username || 'Unknown member'}</h2>
      <dl><dt>Discord username</dt><dd>{member.username || 'Unknown'}</dd>
        <dt>UID</dt><dd><code>{member.uid}</code></dd>
        <dt>Roles</dt><dd>{member.roles?.length ? member.roles.map(role => role.name).join(', ') : 'No assigned roles'}</dd>
        <dt>Joined server</dt><dd>{member.joinedAt ? <time dateTime={member.joinedAt}>{formatDate(member.joinedAt)}</time> : 'Unknown'}</dd>
        <dt>Discord account created</dt><dd>{member.accountCreatedAt ? <time dateTime={member.accountCreatedAt}>{formatDate(member.accountCreatedAt)}</time> : 'Unknown'}</dd>
      </dl></article>)}</div>
  </div>;
}
function Settings({ guild, channels, onToggle, onPurge, pending, settingsError, settingsNotice }) { const enabledCount = channels.filter(c => c.enabled).length; return <div className="page-content"><div className="heading-row"><div><h1>Channel settings</h1></div></div><div className="settings-intro card"><div className="settings-intro-icon"><Icon name="sliders" size={23}/></div><div><h2>Archiving</h2><p>Enabling a channel starts saving new messages. Disabling stops collecting and hides saved messages here; it does not delete them.</p></div></div><section className="card settings-card"><div className="settings-header"><div><h2>Enabled channels</h2><p>Purge deletes this channel’s saved messages, but collection continues while enabled. To stop and erase: disable, then purge. Backups require separate deletion.</p></div><span className="settings-count">{enabledCount} of {channels.length} enabled</span></div>{settingsError && <div className="inline-alert" role="alert"><Icon name="info" size={17}/>{settingsError}</div>}{settingsNotice && <div className="inline-success" role="status"><Icon name="check" size={17}/>{settingsNotice}</div>}<div className="settings-list">{channels.length ? channels.map(c => <div className="settings-row" key={c.id}><div className={`settings-channel-icon ${c.enabled ? '' : 'muted'}`}><Icon name="hash" size={20}/></div><div className="settings-row-info"><strong>{c.name}</strong><span>{formatNumber(c.messageCount)} archived messages</span></div><span className={`status-label ${c.enabled ? 'status-enabled' : ''}`}><span/>{c.enabled ? 'Enabled' : 'Disabled'}</span><button type="button" className="purge-button" disabled={Boolean(pending)} onClick={() => onPurge(c)} aria-label={`Purge archived messages from ${c.name}`}>Purge</button><button type="button" role="switch" aria-checked={Boolean(c.enabled)} aria-label={`${c.enabled ? 'Disable' : 'Enable'} ${c.name}`} className={`toggle ${c.enabled ? 'toggle-on' : ''}`} disabled={pending === c.id} onClick={() => onToggle(c)}><span/></button></div>) : <StatePanel compact icon="inbox" title="No channels found" description="There are no channels to configure in this community."/>}</div></section><div className="settings-note"><Icon name="info" size={17}/><p>Visibility switches don’t change community permissions. Purging permanently deletes this app’s archived copies, not the original community messages.</p></div></div>; }
function Dashboard({ user, guilds, onLogout, loggingOut, onUnauthorized }) { const [guildId, setGuildId] = useState(guilds[0]?.id || ''); const [channels, setChannels] = useState([]); const [channelsLoading, setChannelsLoading] = useState(true); const [channelsRefresh, setChannelsRefresh] = useState(0); const [channelsError, setChannelsError] = useState(''); const [guildData, setGuildData] = useState(null); const [channelId, setChannelId] = useState(''); const [view, setView] = useState('archive'); const [archiveChannelId, setArchiveChannelId] = useState(''); const [sidebarOpen, setSidebarOpen] = useState(false); const [messages, setMessages] = useState([]); const [archiveResultKey, setArchiveResultKey] = useState(''); const [archiveErrorKey, setArchiveErrorKey] = useState(''); const [nextBefore, setNextBefore] = useState(null); const [messagesLoading, setMessagesLoading] = useState(false); const [loadingMore, setLoadingMore] = useState(false); const [messagesError, setMessagesError] = useState(''); const [messageRefresh, setMessageRefresh] = useState(0); const [stats, setStats] = useState(null); const [statsResultKey, setStatsResultKey] = useState(''); const [statsErrorKey, setStatsErrorKey] = useState(''); const [statsLoading, setStatsLoading] = useState(false); const [statsError, setStatsError] = useState(''); const [statsRefresh, setStatsRefresh] = useState(0); const [mediaItems, setMediaItems] = useState([]); const [mediaResultKey, setMediaResultKey] = useState(''); const [mediaErrorKey, setMediaErrorKey] = useState(''); const [mediaLoading, setMediaLoading] = useState(false); const [mediaLoadingMore, setMediaLoadingMore] = useState(false); const [mediaBefore, setMediaBefore] = useState(null); const [mediaError, setMediaError] = useState(''); const [mediaRefresh, setMediaRefresh] = useState(0); const [days, setDays] = useState(30); const [search, setSearch] = useState(''); const [pending, setPending] = useState(''); const [purgeTarget, setPurgeTarget] = useState(null); const [settingsError, setSettingsError] = useState(''); const [settingsNotice, setSettingsNotice] = useState(''); const [forbidden, setForbidden] = useState(false); const guild = { ...guilds.find(g => g.id === guildId), ...guildData }; const channel = channels.find(c => c.id === channelId) || null;
  useEffect(() => { if (!guildId) { setChannelsLoading(false); return; } let active = true; setChannelsLoading(true); setChannelsError(''); setChannels([]); setGuildData(null); setChannelId(''); setArchiveChannelId(''); setStats(null); setMessages([]); setArchiveResultKey(''); setMediaItems([]); setMediaResultKey(''); setMediaBefore(null); api(`/api/guilds/${encodeURIComponent(guildId)}/channels`).then(data => { if (!active) return; const items = Array.isArray(data?.channels) ? data.channels : []; setChannels(items); setGuildData(data?.guild || null); setChannelId(items.find(c => c.enabled)?.id || items[0]?.id || ''); }).catch(err => { if (!active) return; if (err.status === 401) onUnauthorized(); else if (err.status === 403) setForbidden(true); else setChannelsError(readableError(err)); }).finally(() => { if (active) setChannelsLoading(false); }); return () => { active = false; }; }, [guildId, onUnauthorized, channelsRefresh]);
  const archiveKey = `${guildId}:${archiveChannelId}:${channels.map(c => `${c.id}-${c.enabled}-${c.messageCount}`).join(',')}:${view}:${messageRefresh}`;
  const archiveKeyRef = useRef(archiveKey);
  const archiveGeneration = useRef(0);
  if (archiveKeyRef.current !== archiveKey) { archiveKeyRef.current = archiveKey; archiveGeneration.current++; }
  useEffect(() => () => { archiveGeneration.current++; }, []);
  const archivePath = archiveChannelId ? `/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(archiveChannelId)}/messages` : `/api/guilds/${encodeURIComponent(guildId)}/messages`;
  useEffect(() => {
    setSearch(''); setMessages([]); setArchiveResultKey(''); setArchiveErrorKey(''); setNextBefore(null); setMessagesError(''); setLoadingMore(false);
    if (!guildId || channelsLoading || !channels.some(c => c.enabled) || (archiveChannelId && !channels.some(c => c.id === archiveChannelId && c.enabled)) || view !== 'archive') { setMessagesLoading(false); return; }
    let active = true;
    setMessagesLoading(true);
    api(`${archivePath}?limit=50`).then(data => { if (active) { setMessages(Array.isArray(data?.messages) ? data.messages : []); setArchiveResultKey(archiveKey); setNextBefore(data?.nextBefore || null); } })
      .catch(err => { if (!active) return; if (err.status === 401) onUnauthorized(); else { setMessagesError(readableError(err)); setArchiveErrorKey(archiveKey); } })
      .finally(() => { if (active) setMessagesLoading(false); });
    return () => { active = false; };
  }, [archiveKey, archivePath, guildId, archiveChannelId, channelsLoading, view, onUnauthorized]);
  const statsKey = `${guildId}:${channelId}:${channel?.enabled}:${channel?.messageCount}:${view}:${days}:${statsRefresh}`;
  useEffect(() => { setStats(null); setStatsResultKey(''); setStatsErrorKey(''); setStatsError(''); if (!guildId || channelsLoading || !channelId || !channel?.enabled || view !== 'statistics') { setStatsLoading(false); return; } let active = true; setStatsLoading(true); api(`/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(channelId)}/stats?days=${days}`).then(data => { if (active) { setStats(data); setStatsResultKey(statsKey); } }).catch(err => { if (!active) return; if (err.status === 401) onUnauthorized(); else { setStatsError(err.status === 403 ? 'You don’t have permission to view activity for this channel.' : readableError(err)); setStatsErrorKey(statsKey); } }).finally(() => { if (active) setStatsLoading(false); }); return () => { active = false; }; }, [guildId, channelsLoading, channelId, channel?.enabled, channel?.messageCount, view, days, statsRefresh, onUnauthorized]);
  const mediaKey = `${guildId}:${channelId}:${channel?.enabled}:${channel?.messageCount}:${view}:${mediaRefresh}`;
  const mediaKeyRef = useRef(mediaKey);
  const mediaGeneration = useRef(0);
  if (mediaKeyRef.current !== mediaKey) { mediaKeyRef.current = mediaKey; mediaGeneration.current++; }
  useEffect(() => () => { mediaGeneration.current++; }, []);
  useEffect(() => {
    setMediaItems([]); setMediaResultKey(''); setMediaErrorKey(''); setMediaBefore(null); setMediaError(''); setMediaLoadingMore(false);
    if (!guildId || channelsLoading || !channelId || !channel?.enabled || view !== 'media') { setMediaLoading(false); return; }
    let active = true; setMediaLoading(true);
    api(`/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(channelId)}/media?limit=50`)
      .then(data => { if (active) { setMediaItems(Array.isArray(data?.media) ? data.media : []); setMediaResultKey(mediaKey); setMediaBefore(data?.nextBefore || null); } })
      .catch(err => { if (!active) return; if (err.status === 401) onUnauthorized(); else { setMediaError(err.status === 403 ? 'You don’t have permission to see this channel’s media.' : readableError(err)); setMediaErrorKey(mediaKey); } })
      .finally(() => { if (active) setMediaLoading(false); });
    return () => { active = false; };
  }, [guildId, channelsLoading, channelId, channel?.enabled, channel?.messageCount, view, mediaRefresh, onUnauthorized]);
  async function loadMoreMedia() {
    if (!mediaBefore || mediaLoadingMore) return;
    const key = mediaKeyRef.current;
    const generation = mediaGeneration.current;
    setMediaLoadingMore(true); setMediaError('');
    try {
      const data = await api(`/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(channelId)}/media?limit=50&before=${encodeURIComponent(mediaBefore)}`);
      if (key !== mediaKeyRef.current || generation !== mediaGeneration.current) return;
      setMediaItems(previous => [...previous, ...(Array.isArray(data?.media) ? data.media : [])]);
      setMediaBefore(data?.nextBefore || null);
    } catch (err) { if (key === mediaKeyRef.current && generation === mediaGeneration.current) { if (err.status === 401) onUnauthorized(); else setMediaError(readableError(err)); } }
    finally { if (key === mediaKeyRef.current && generation === mediaGeneration.current) setMediaLoadingMore(false); }
  }
  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    const key = archiveKeyRef.current;
    const generation = archiveGeneration.current;
    const path = archivePath;
    setLoadingMore(true); setMessagesError('');
    try {
      const data = await api(`${path}?before=${encodeURIComponent(nextBefore)}&limit=50`);
      if (key !== archiveKeyRef.current || generation !== archiveGeneration.current) return;
      if (Array.isArray(data?.messages)) setMessages(prev => { const seen = new Set(prev.map(m => m.id)); return [...prev, ...data.messages.filter(m => !seen.has(m.id))]; });
      setNextBefore(data?.nextBefore || null);
    } catch (err) { if (key === archiveKeyRef.current && generation === archiveGeneration.current) { if (err.status === 401) onUnauthorized(); else setMessagesError(readableError(err)); } }
    finally { if (key === archiveKeyRef.current && generation === archiveGeneration.current) setLoadingMore(false); }
  }
  async function toggleChannel(c) { if (pending) return; setPending(c.id); setSettingsError(''); setSettingsNotice(''); try { const csrf = await api('/api/csrf'); if (!csrf?.token) throw new Error('Unable to verify this request. Please try again.'); await api(`/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(c.id)}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrf.token }, body: JSON.stringify({ enabled: !c.enabled }) }); setChannels(prev => prev.map(item => item.id === c.id ? { ...item, enabled: !c.enabled } : item)); setSettingsNotice(`#${c.name} ${c.enabled ? 'disabled' : 'enabled'} successfully.`); } catch (err) { if (err.status === 401) onUnauthorized(); else setSettingsError(err.status === 403 ? 'You don’t have permission to change channel settings.' : readableError(err)); } finally { setPending(''); } }
  async function purgeChannel() { const target = purgeTarget; if (!target || pending) return; setPending(target.id); setSettingsError(''); setSettingsNotice(''); try { const csrf = await api('/api/csrf'); if (!csrf?.token) throw new Error('Unable to verify this request. Please try again.'); await api(`/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(target.id)}/messages`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf.token } }); setChannels(prev => prev.map(item => item.id === target.id ? { ...item, messageCount: 0 } : item)); if (target.id === channelId) { setMessages([]); setNextBefore(null); setStats(null); setMediaItems([]); setMediaBefore(null); } setSettingsNotice(`Archived messages in #${target.name} were permanently purged.`); setPurgeTarget(null); } catch (err) { if (err.status === 401) onUnauthorized(); else setSettingsError(err.status === 403 ? 'You don’t have permission to purge this channel’s archive.' : readableError(err)); } finally { setPending(''); } }
  if (forbidden) return <AccessState title="Administrator access required" description="This workspace is only available to community administrators. If you think this is a mistake, contact your server administrator." user={user} onLogout={onLogout} loggingOut={loggingOut}/>;
  return <div className="app-shell">{purgeTarget && <div className="modal-backdrop" onClick={() => !pending && setPurgeTarget(null)}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="purge-title" aria-describedby="purge-description" onClick={event => event.stopPropagation()}><div className="modal-danger-icon"><Icon name="info" size={24}/></div><h2 id="purge-title">Purge #{purgeTarget.name}?</h2><p id="purge-description">This removes saved messages for this channel from ArchiveMe, not from Discord or separate backups. If this channel remains enabled, new messages will continue to be saved. Disable it first to stop collection.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setPurgeTarget(null)} disabled={Boolean(pending)}>Cancel</button><button className="danger-button" onClick={purgeChannel} disabled={Boolean(pending)}>{pending ? 'Purging…' : 'Purge archived messages'}</button></div></section></div>}<Sidebar guilds={guilds} guild={guild} setGuildId={setGuildId} view={view} setView={setView} setArchiveChannelId={setArchiveChannelId} open={sidebarOpen} close={() => setSidebarOpen(false)} user={user} onLogout={onLogout} loggingOut={loggingOut}/><main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Icon name="menu" size={21}/></button><div className="breadcrumb"><strong>{view === 'archive' ? 'Server archive' : view === 'statistics' ? 'Statistics' : view === 'media' ? 'Media & emotes' : view === 'members' ? 'Members' : view === 'settings' ? 'Channel settings' : 'Server archive'}</strong></div></div><div className="topbar-right"><Avatar src={getAvatar(user)} name={user?.username} size="small"/></div></header>{channelsLoading ? <div className="page-content page-loading"><LoadingBlock lines={8}/></div> : channelsError ? <div className="page-content"><StatePanel icon="info" title="Couldn’t open this community" description={channelsError} action={<button className="text-button" onClick={() => setChannelsRefresh(n => n + 1)}>Try again <Icon name="arrow" size={16}/></button>}/></div> : view === 'statistics' ? <Statistics guild={guild} channels={channels} channel={channel} setChannelId={setChannelId} stats={statsResultKey === statsKey ? stats : null} loading={statsLoading || (statsResultKey !== statsKey && statsErrorKey !== statsKey && Boolean(channel?.enabled))} error={statsErrorKey === statsKey ? statsError : ''} days={days} setDays={setDays} retry={() => setStatsRefresh(n => n + 1)}/> : view === 'media' ? <Media key={`${guildId}:${channelId}:${mediaRefresh}:${channel?.enabled}:${channel?.messageCount}`} guild={guild} channels={channels} channel={channel} setChannelId={setChannelId} items={mediaResultKey === mediaKey ? mediaItems : []} loading={mediaLoading || (mediaResultKey !== mediaKey && mediaErrorKey !== mediaKey && Boolean(channel?.enabled))} loadingMore={mediaResultKey === mediaKey && mediaLoadingMore} nextBefore={mediaResultKey === mediaKey ? mediaBefore : null} error={mediaErrorKey === mediaKey ? mediaError : ''} loadMore={loadMoreMedia} retry={() => setMediaRefresh(n => n + 1)}/> : view === 'members' ? <Members key={guildId} guildId={guildId} onUnauthorized={onUnauthorized}/> : view === 'archive' ? <Archive key={`${guildId}:${archiveChannelId}:${messageRefresh}:${channels.map(c => `${c.id}-${c.enabled}-${c.messageCount}`).join(',')}`} channels={channels} channelId={archiveChannelId} setChannelId={setArchiveChannelId} messages={archiveResultKey === archiveKey ? messages : []} loading={messagesLoading || (archiveResultKey !== archiveKey && archiveErrorKey !== archiveKey && channels.some(c => c.enabled))} loadingMore={archiveResultKey === archiveKey && loadingMore} nextBefore={archiveResultKey === archiveKey ? nextBefore : null} error={archiveErrorKey === archiveKey ? messagesError : ''} search={search} setSearch={setSearch} loadMore={loadMore} retry={() => setMessageRefresh(n => n + 1)}/> : <Settings guild={guild} channels={channels} onToggle={toggleChannel} onPurge={setPurgeTarget} pending={pending} settingsError={settingsError} settingsNotice={settingsNotice}/>}</main></div>; }
function AccessState({ title, description, user, onLogout, loggingOut }) { return <main className="access-layout"><div className="access-top"><Logo/></div><div className="access-card"><div className="access-icon"><Icon name="shield" size={30}/></div><div className="eyebrow">ACCESS NOTICE</div><h1>{title}</h1><p>{description}</p><div className="access-actions"><button className="secondary-button" onClick={onLogout} disabled={loggingOut}><Icon name="logout" size={17}/>{loggingOut ? 'Signing out…' : 'Sign out'}</button></div>{user && <span className="access-user">Signed in as {user.username}</span>}</div></main>; }
function App() { const [session, setSession] = useState(null); const [status, setStatus] = useState('loading'); const [error, setError] = useState(''); const [loggingOut, setLoggingOut] = useState(false); const onUnauthorized = useCallback(() => { setStatus('login'); setSession(null); setError('Your session has expired. Please sign in again.'); }, []); useEffect(() => { let active = true; api('/api/me').then(data => { if (!active) return; if (data?.authenticated) { setSession(data); setStatus('dashboard'); } else setStatus('login'); }).catch(err => { if (!active) return; if (err.status === 401) setStatus('login'); else if (err.status === 403) setStatus('forbidden'); else { setStatus('login'); setError('We couldn’t check your session. Please try signing in.'); } }).finally(() => { if (active && window.location.search.includes('error=')) { const params = new URLSearchParams(window.location.search); setError(params.get('error') === 'access_denied' ? 'Access was denied. Please try again.' : 'Sign-in didn’t complete. Please try again.'); } }); return () => { active = false; }; }, []); async function logout() { setLoggingOut(true); try { const csrf = await api('/api/csrf'); await api('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf.token } }); setSession(null); setStatus('login'); setError(''); } catch (err) { if (err.status === 401) { setSession(null); setStatus('login'); } else setError(readableError(err)); } finally { setLoggingOut(false); } } if (status === 'loading') return <div className="boot-loading"><Logo/><div className="spinner" role="status" aria-label="Loading your archive"/></div>; if (status === 'forbidden') return <AccessState title="Access unavailable" description="You don’t have permission to open this archive. Please use an administrator account or contact your server administrator." onLogout={logout} loggingOut={loggingOut}/>; if (status === 'login') return <Login error={error}/>; if (!session?.guilds?.length) return <AccessState title="No communities available" description="Your account doesn’t have an accessible admin workspace yet. Make sure you’re an administrator of a connected community." user={session?.user} onLogout={logout} loggingOut={loggingOut}/>; return <Dashboard user={session.user} guilds={session.guilds} onLogout={logout} loggingOut={loggingOut} onUnauthorized={onUnauthorized}/>; }

createRoot(document.getElementById('root')).render(<App/>);
