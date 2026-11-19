export const config = { maxDuration: 60 };

// 远程 MCP 入口：Streamable HTTP（无状态），客户端直接配置 URL + DRAW_API_KEY 即可。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDrawClient, registerDrawTools } from '../mcp-server/tools.js';
import { extractApiKey, verifyApiKey } from './lib/ai-auth.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, Mcp-Session-Id, Mcp-Protocol-Version, Accept',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const auth = verifyApiKey(extractApiKey(req.headers, requestUrl.searchParams));
  if (auth.error) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  // 无状态模式不支持 SSE 长连接，GET 只用于协议探测
  if (req.method === 'GET') {
    sendJson(res, 405, { error: '该 MCP 服务为无状态模式，请使用 POST' });
    return;
  }

  if (req.method === 'DELETE') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '只支持 POST' });
    return;
  }

  const baseUrl = process.env.LIGHTCHAT_BASE_URL || `https://${req.headers.host || ''}`;
  const server = new McpServer({ name: 'lightchat-draw', version: '1.0.0' });
  registerDrawTools(server, createDrawClient({ baseUrl, apiKey: process.env.DRAW_API_KEY || '' }));

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('[mcp] 请求处理失败:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'MCP 请求处理失败' });
    }
  }
}
