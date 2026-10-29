import test from 'node:test';
import assert from 'node:assert/strict';
import { isLottieStickerUrl, validStickerAnimation, fetchStickerAnimation } from '../web/src/lottieSticker.js';

const id = '623456789012345681';
const url = `https://cdn.discordapp.com/stickers/${id}.json`;
const animation = () => ({ w: 320, h: 320, fr: 30, ip: 0, op: 60,
  layers: [{ ty: 4, shapes: [] }], assets: [{ id: 'comp', layers: [{ ty: 4, shapes: [] }] }] });

test('sticker animation URLs are restricted to canonical Discord JSON paths', () => {
  assert.equal(isLottieStickerUrl(url), true);
  for (const candidate of [url + '?token=x', url + '#fragment', url.replace('cdn.discordapp.com', 'cdn.discordapp.com.evil.test'),
    url.replace('https:', 'http:'), `https://cdn.discordapp.com/stickers/${id}.png`,
    `https://user@cdn.discordapp.com/stickers/${id}.json`, 'https://cdn.discordapp.com/stickers/../evil.json']) {
    assert.equal(isLottieStickerUrl(candidate), false, candidate);
  }
});

test('Lottie validation rejects external assets, expressions, and excessive data', () => {
  assert.equal(validStickerAnimation(animation()), true);
  for (const data of [
    { ...animation(), w: 10000 }, { ...animation(), fr: 500 },
    { ...animation(), layers: Array(200).fill({}) },
    { ...animation(), assets: [{ id: 'x', p: 'image.png', u: 'https://evil.example/' }] },
    { ...animation(), layers: [{ ty: 4, x: 'evil()' }] },
    { ...animation(), layers: [{ ty: 4, refId: 'https://evil.example/' }] },
    { ...animation(), layers: [{ ty: 4, nm: 'data:image/svg+xml;base64,AAA' }] }
  ]) assert.equal(validStickerAnimation(data), false);
});

test('browser fetch is CORS-readable, limited, and never sends credentials', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let opts;
  globalThis.fetch = async (input, options) => {
    assert.equal(input, url); opts = options;
    return new Response(JSON.stringify(animation()), { headers: { 'content-type': 'application/json' } });
  };
  assert.equal((await fetchStickerAnimation(url)).w, 320);
  assert.equal(opts.credentials, 'omit');
  assert.equal(opts.redirect, 'error');
  globalThis.fetch = async () => new Response('x'.repeat(1_000_001), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(fetchStickerAnimation(url), /too large/);
  await assert.rejects(fetchStickerAnimation('https://evil.example/stickers/123.json'), /Invalid sticker URL/);
});
