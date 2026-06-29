import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const SOURCE_ENV_MAP = {
  luxee: {
    key: 'API_KEY_LUXEE',
    endpoint: 'https://api.luxee.ai/v1/chat/completions',
  },
  rightcode: {
    key: 'API_KEY_RIGHTCODE',
    endpoint: 'https://www.right.codes/codex/v1/chat/completions',
    pricing: {
      daily: 'https://www.right.codes/codex/v1/responses',
    },
  },
};

function createProxyPlugin(env) {
  return {
    name: 'local-chat-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Source, X-Pricing');
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

        const source = ((req.headers['x-source'] || 'luxee') + '').toLowerCase();
        const pricing = ((req.headers['x-pricing'] || '') + '').toLowerCase();
        const sourceConfig = SOURCE_ENV_MAP[source];

        if (!sourceConfig) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: `Unknown source: ${source}. Available: luxee, rightcode.` }));
          return;
        }

        const serverApiKey = env[sourceConfig.key] || '';
        let serverEndpoint = '';
        if (pricing && sourceConfig.pricing && sourceConfig.pricing[pricing]) {
          serverEndpoint = sourceConfig.pricing[pricing];
        } else {
          serverEndpoint = sourceConfig.endpoint || '';
        }

        if (!serverEndpoint) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: `Server endpoint not configured for source: ${source}. Check .env file.` }));
          return;
        }

        let parsedUrl;
        try {
          parsedUrl = new URL(serverEndpoint);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Invalid server endpoint configuration.' }));
          return;
        }

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Server endpoint must use http or https.' }));
          return;
        }

        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }

        const body = Buffer.concat(chunks);

        const upstreamHeaders = {
          'content-type': req.headers['content-type'] || 'application/json',
        };
        if (serverApiKey) {
          upstreamHeaders.authorization = `Bearer ${serverApiKey}`;
        }

        try {
          const upstreamResponse = await fetch(serverEndpoint, {
            method: 'POST',
            headers: upstreamHeaders,
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

/**
 * 移除 animal-island-ui 中 3 个 Noto Sans SC 简体中文 @font-face 声明
 * 每个约 1.15MB，总计 ~3.5MB；项目已使用系统字体，这些字体完全多余
 */
function stripChineseFontsPlugin() {
  const FONT_FACE_RE = /@font-face\s*\{[^}]*noto-sans-sc-chinese-simplified[^}]*\}/g;
  return {
    name: 'strip-chinese-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.css')) return null;
      if (!code.includes('noto-sans-sc-chinese-simplified')) return null;
      const stripped = code.replace(FONT_FACE_RE, '');
      if (stripped === code) return null;
      return { code: stripped, map: null };
    },
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.includes('noto-sans-sc-chinese-simplified')) {
          delete bundle[fileName];
          continue;
        }
        if (fileName.endsWith('.css') && chunk.type === 'asset') {
          const source =
            typeof chunk.source === 'string'
              ? chunk.source
              : new TextDecoder().decode(chunk.source);
          if (source.includes('noto-sans-sc-chinese-simplified')) {
            chunk.source = source.replace(FONT_FACE_RE, '');
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiTarget = env.VITE_API_TARGET || 'https://www.lightchat.online';

  return {
    base: './',
    plugins: [react(), createProxyPlugin(env), stripChineseFontsPlugin()],
    server: {
      host: true,
      proxy: {
        '/api/auth': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
        '/api/data': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
        '/api/draw-task': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
        '/api/draw': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: 'index.html',
      },
    },
  };
});
