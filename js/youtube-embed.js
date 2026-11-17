const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

export function youtubeVideoId(value) {
  let url;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (YOUTUBE_HOSTS.has(url.hostname)) {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
  }
  return VIDEO_ID.test(id || '') ? id : null;
}

export function youtubeEmbedUrl(id) {
  if (!VIDEO_ID.test(id || '')) return null;
  // 靜音才能自動播放。保留 YouTube 的控制列，讓使用者在播放器內解除靜音。
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}`
    + '&playsinline=1&rel=0&controls=1&disablekb=1&fs=0&iv_load_policy=3';
}
