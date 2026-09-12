import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AccessContext } from '@/server/access/types';
import { requireOperation, OperationError } from '@/server/operations/common';
import { type ReadToolDefinition } from './read-tools';
import { readToolsForContext } from './postgres-pilot';
import { MAX_OUTPUT_BYTES } from './config';
import { toolError } from './errors';
export function allowedReadTools(context: AccessContext): ReadToolDefinition[] {
  return readToolsForContext(context).filter(tool => {
    try {
      if (!context.active || context.mustChangePassword || context.actor.source !== 'mcp') return false;
      if (tool.capability) requireOperation(context, tool.capability, tool.page);
      return true;
    } catch { return false; }
  });
}
export function createMcpServer(context: AccessContext) {
  const server = new McpServer({ name: 'br-steel', version: '0.4.0' });
  for (const tool of allowedReadTools(context)) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.schema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
      try {
        // Registration is not authorization. Each invocation checks current request context again.
        if (tool.capability) requireOperation(context, tool.capability, tool.page);
        const args = tool.schema.parse(raw);
        const output = await tool.run(context, args);
        const response = { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
        if (Buffer.byteLength(JSON.stringify(response)) > MAX_OUTPUT_BYTES - 1024) throw new OperationError('OUTPUT_LIMIT', 'A resposta excede o limite. Reduza o período ou o número de itens por página.');
        return response;
      } catch (error) { return toolError(error); }
    });
  }
  return server;
}
