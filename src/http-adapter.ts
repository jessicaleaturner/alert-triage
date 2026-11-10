import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Handler } from './app.ts';

const MAX_BODY_BYTES = 1_000_000;

/** Wraps a transport-agnostic handler in a plain Node HTTP server. */
export function createHttpServer(handle: Handler): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'body too large' }));
        return;
      }

      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        }
        const response = handle({
          method: req.method ?? 'GET',
          path: url.pathname,
          headers,
          query: Object.fromEntries(url.searchParams),
          body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        console.error(error);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
    });
  });
}
