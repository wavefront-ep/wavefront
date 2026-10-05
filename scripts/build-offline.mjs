// Packs the built site (dist/) into one self-contained file, dist-offline/wavefront.html, that opens
// by double-click with no server and no internet: scripts, styles, fonts, the icon and every model
// file are embedded. Run after `vite build` (npm run build:offline does both).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const dist = 'dist';
const out = 'dist-offline';
const MIME = { '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.json': 'application/json', '.bin': 'application/octet-stream' };
const dataUri = (file) => `data:${MIME[extname(file)] ?? 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;

let html = readFileSync(join(dist, 'index.html'), 'utf8');

// styles, with their fonts inlined
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
  const file = join(dist, href);
  const css = readFileSync(file, 'utf8').replace(/url\(([^)]+)\)/g, (m, u) => {
    const name = u.replace(/['"]/g, '');
    if (name.startsWith('data:')) return m;
    return `url(${dataUri(join(file, '..', name))})`;
  });
  return `<style>${css}</style>`;
});
html = html.replace(/<link rel="icon"[^>]*href="([^"]+)"[^>]*>/, (_, href) => `<link rel="icon" type="image/svg+xml" href="${dataUri(join(dist, href))}" />`);

// model files, served to the app through a fetch shim
const heartDir = join(dist, 'heart');
const files = {};
for (const f of readdirSync(heartDir)) files[f] = readFileSync(join(heartDir, f)).toString('base64');
const shim = `<script>(()=>{const A=${JSON.stringify(files)};const T={glb:'model/gltf-binary',json:'application/json',bin:'application/octet-stream'};const f=window.fetch.bind(window);window.fetch=(u,o)=>{const s=typeof u==="string"?u:u.url||String(u);const i=s.lastIndexOf('heart/');const k=i<0?'':s.slice(i+6);if(A[k]){const b=atob(A[k]);const a=new Uint8Array(b.length);for(let j=0;j<b.length;j++)a[j]=b.charCodeAt(j);return Promise.resolve(new Response(a,{headers:{'content-type':T[k.split('.').pop()]||'application/octet-stream'}}))}return f(u,o)}})();</script>`;

// the app bundle, inline (an inline module runs from file://; a linked one is blocked)
let bundle = '';
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/, (_, src) => {
  bundle = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '';
});
if (!bundle) throw new Error('app bundle not found in dist/index.html');
html = html.replace('</body>', () => `${shim}\n<script type="module">${bundle}</script>\n</body>`); // a function, so `$&` in the bundle is not read as a replacement pattern

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'wavefront.html'), html);
if (existsSync(join(dist, 'guide.html'))) copyFileSync(join(dist, 'guide.html'), join(out, 'guide.html'));
console.log(`${join(out, 'wavefront.html')}: ${(html.length / 1e6).toFixed(1)} MB`);
