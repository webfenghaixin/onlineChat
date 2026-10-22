import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const CHAT_ENDPOINT = 'https://www.rightapi.ai/v1/chat/completions';
const CHAT_KEY_ENV = 'API_KEY_CHAT';

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

        const serverApiKey = env[CHAT_KEY_ENV] || '';
        const serverEndpoint = CHAT_ENDPOINT;

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
        '/api/balance': {
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
