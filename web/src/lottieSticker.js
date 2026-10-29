// Browser-only, bounded Discord sticker JSON. No animation or binary content is sent to ArchiveMe.
export function isLottieStickerUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.discordapp.com' && !url.username && !url.password && !url.port
      && /^\/stickers\/\d{16,22}\.json$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

// The renderer can load external assets even in canvas mode: accept only self-contained
// vector animations. Reject embedded/external images, expressions, URLs, and excessive data.
export function validStickerAnimation(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
    !Number.isFinite(data.w) || !Number.isFinite(data.h) ||
    data.w < 1 || data.h < 1 || data.w > 512 || data.h > 512 ||
    !Number.isFinite(data.fr) || data.fr < 1 || data.fr > 120 ||
    !Number.isFinite(data.ip) || !Number.isFinite(data.op) ||
    data.op <= data.ip || data.op - data.ip > 1200 ||
    !Array.isArray(data.layers) || !data.layers.length || data.layers.length > 160 ||
    !Array.isArray(data.assets) || data.assets.length > 160) return false;
  const stack = [data];
  let visited = 0;
  while (stack.length) {
    if (++visited > 75000) return false;
    const node = stack.pop();
    if (Array.isArray(node)) {
      if (node.length > 15000) return false;
      stack.push(...node);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (['x', 'u', 'p', 'base64', 'url', 'src', 'href', 'refId'].includes(key) && typeof value === 'string') {
          if (key !== 'refId' || !/^[_a-zA-Z0-9-]{1,80}$/.test(value)) return false;
        }
        if (typeof value === 'string' && /(?:https?:|data:|blob:|javascript:|\/\/)/i.test(value)) return false;
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }
  // Precompositions with nested vector layers are fine; no image/footage assets.
  return data.assets.every(asset => asset && Array.isArray(asset.layers) && !('p' in asset) && !('u' in asset));
}

export async function fetchStickerAnimation(url, signal) {
  if (!isLottieStickerUrl(url)) throw new Error('Invalid sticker URL');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal, referrerPolicy: 'no-referrer' });
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw new Error('Sticker unavailable');
  const length = Number(response.headers.get('content-length'));
  if (length > 1_000_000) throw new Error('Sticker too large');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_000_000) throw new Error('Sticker too large');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!validStickerAnimation(data)) throw new Error('Unsupported sticker animation');
  return data;
}
