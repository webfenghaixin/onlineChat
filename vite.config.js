import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { URL } from 'node:url';

function createProxyPlugin() {
  return {
    name: 'local-chat-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Target-URL');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Only POST is allowed.' }));
          return;
        }

        const targetUrl = req.headers['x-target-url'];
        if (typeof targetUrl !== 'string' || !targetUrl.trim()) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Missing X-Target-URL header.' }));
          return;
        }

        let parsedUrl;
        try {
          parsedUrl = new URL(targetUrl);
        } catch (error) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Invalid target URL.' }));
          return;
        }

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Target URL must use http or https.' }));
          return;
        }

        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }

        const body = Buffer.concat(chunks);

        try {
          const upstreamResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'content-type': req.headers['content-type'] || 'application/json',
              authorization: req.headers.authorization || '',
            },
            body,
          });

          res.statusCode = upstreamResponse.status;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader(
            'Content-Type',
            upstreamResponse.headers.get('content-type') || 'application/octet-stream',
          );

          const cacheControl = upstreamResponse.headers.get('cache-control');
          if (cacheControl) {
            res.setHeader('Cache-Control', cacheControl);
          }

          if (!upstreamResponse.body) {
            const text = await upstreamResponse.text();
            res.end(text);
            return;
          }

          const reader = upstreamResponse.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            res.write(Buffer.from(value));
          }

          res.end();
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: 'Proxy request failed.',
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), createProxyPlugin()],
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      input: 'index.html',
    },
  },
});
