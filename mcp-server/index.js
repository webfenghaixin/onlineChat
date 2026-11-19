#!/usr/bin/env node
// 本地 stdio MCP 服务器：供 Trae / Cursor / Claude Desktop 等客户端以子进程方式启动。
// 环境变量：
//   LIGHTCHAT_BASE_URL  后端地址，默认 https://www.lightchat.online
//   DRAW_API_KEY        服务端配置的固定制图 Key（必填）

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDrawClient, registerDrawTools } from './tools.js';

async function main() {
  const baseUrl = process.env.LIGHTCHAT_BASE_URL || 'https://www.lightchat.online';
  const apiKey = process.env.DRAW_API_KEY || '';

  if (!apiKey) {
    // stdio 模式下 stdout 属于协议通道，日志只能写 stderr
    console.error('[lightchat-draw] 未设置 DRAW_API_KEY，工具调用会失败');
  }

  const server = new McpServer({ name: 'lightchat-draw', version: '1.0.0' });
  registerDrawTools(server, createDrawClient({ baseUrl, apiKey }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[lightchat-draw] stdio MCP 已启动，后端 ${baseUrl}`);
}

main().catch((error) => {
  console.error('[lightchat-draw] 启动失败:', error);
  process.exit(1);
});
