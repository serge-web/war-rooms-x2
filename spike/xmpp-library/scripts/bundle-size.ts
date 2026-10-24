// Print raw, gzip and brotli sizes of each JS chunk in dist/ and the total per page (entry + shared chunks).
// Run after `vite build`: node scripts/bundle-size.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const dist = resolve(import.meta.dirname, '..', 'dist');
const kb = (n: number): string => `${(n / 1024).toFixed(1)} kB`;
const sizes = new Map<string, { raw: number; gzip: number; brotli: number }>();
for (const f of readdirSync(join(dist, 'assets')).filter((x) => x.endsWith('.js'))) {
  const buf = readFileSync(join(dist, 'assets', f));
  sizes.set(f, { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf).length });
}
console.log('chunk'.padEnd(28), 'raw'.padStart(10), 'gzip -9'.padStart(10), 'brotli'.padStart(10));
for (const [f, s] of sizes) console.log(f.padEnd(28), kb(s.raw).padStart(10), kb(s.gzip).padStart(10), kb(s.brotli).padStart(10));
for (const page of ['stanza', 'xmppjs']) {
  const html = readFileSync(join(dist, `${page}.html`), 'utf8');
  const chunks = [...html.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1] ?? '');
  const total = chunks.reduce((t, c) => ({ raw: t.raw + (sizes.get(c)?.raw ?? 0), gzip: t.gzip + (sizes.get(c)?.gzip ?? 0) }), { raw: 0, gzip: 0 });
  console.log(`${page}.html loads ${chunks.join(' + ')}: ${kb(total.raw)} raw, ${kb(total.gzip)} gzip`);
}
