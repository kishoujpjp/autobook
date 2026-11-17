import { youtubeEmbedUrl } from './youtube-embed.js?v=3';

const src = youtubeEmbedUrl(new URLSearchParams(location.hash.slice(1)).get('v'));
if (src) {
  const frame = document.createElement('iframe');
  frame.title = 'YouTube';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  frame.allow = 'autoplay; encrypted-media';
  frame.src = src;
  document.body.append(frame);
}
