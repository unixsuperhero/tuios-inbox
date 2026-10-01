import { resolve, sep, extname } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT ?? 4401);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.otf':'font/otf', '.md':'text/plain; charset=utf-8', '.svg':'image/svg+xml' };
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const head = request.method === 'HEAD';
    const text = (message,status,headers = {}) => new Response(head ? null : message,{status,headers:{'Content-Type':'text/plain; charset=utf-8',...headers}});
    if (request.method !== 'GET' && !head) return text('Only GET and HEAD are supported.',405,{'Allow':'GET, HEAD'});
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return text('Invalid pathname.',400); }
    if (pathname.includes('\0') || pathname.includes('\\')) return text('Invalid pathname.',400);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(root + sep)) return text('Outside preview directory.',403);
    try {
      const canonical = await realpath(path);
      if (!canonical.startsWith(root + sep)) return text('Outside preview directory.',403);
      const info = await stat(canonical);
      if (!info.isFile()) return text('Not found.',404);
      return new Response(head ? null : Bun.file(canonical), {headers:{
        'Content-Type':mime[extname(canonical)] ?? 'application/octet-stream',
        'Content-Length':String(info.size),
        'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      }});
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return text('Not found.',404);
      return text('File could not be served.',500);
    }
  },
});
console.log(`tuios inbox visual prototypes: http://127.0.0.1:${server.port}/?variant=flight`);
