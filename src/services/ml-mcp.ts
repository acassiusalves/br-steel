'use server';

/**
 * Cliente do MCP oficial do Mercado Livre.
 *
 * Endpoint: https://mcp.mercadolibre.com/mcp
 *
 * Ferramentas expostas pelo MCP do ML (somente leitura de documentação):
 *   - search_documentation(query, language, siteId?, limit?, offset?)
 *   - get_documentation_page(path, language, siteId?)
 *
 * Autenticação: Bearer com o access_token OAuth de uma conta ML conectada.
 * Reaproveita `getMlToken()` que já renova o token e persiste o refresh_token
 * rotacionado em Firestore (vide src/services/mercadolivre.ts).
 *
 * NUNCA exporte o objeto Client. Use somente os wrappers async deste arquivo
 * (esta camada roda apenas no servidor — diretiva 'use server' acima).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getMlToken } from './mercadolivre';

const ML_MCP_URL = 'https://mcp.mercadolibre.com/mcp';

export type MlMcpSearchInput = {
  accountId?: string;
  query: string;
  language: string;
  siteId?: string;
  limit?: number;
  offset?: number;
};

export type MlMcpGetPageInput = {
  accountId?: string;
  path: string;
  language: string;
  siteId?: string;
};

/**
 * Conteúdo bruto retornado pelo MCP (segue o tipo CallToolResult do SDK).
 * Mantemos o shape genérico para repassar à UI sem perder informação.
 */
export type MlMcpCallResult = {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
};

async function createMlMcpClient(accountId?: string): Promise<Client> {
  const token = await getMlToken(accountId);
  if (!token) {
    throw new Error('Sem access_token disponível para a conta selecionada.');
  }

  const transport = new StreamableHTTPClientTransport(new URL(ML_MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const client = new Client(
    {
      name: 'br-steel-ml-docs',
      version: '1.0.0',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);
  return client;
}

async function callMlMcpTool(
  accountId: string | undefined,
  toolName: string,
  args: Record<string, unknown>,
): Promise<MlMcpCallResult> {
  const client = await createMlMcpClient(accountId);
  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return result as MlMcpCallResult;
  } finally {
    try {
      await client.close();
    } catch (e) {
      console.warn('[ml-mcp] erro ao fechar client (ignorado):', e);
    }
  }
}

export async function searchMlDocumentation(
  input: MlMcpSearchInput,
): Promise<MlMcpCallResult> {
  if (!input.query?.trim()) throw new Error('query é obrigatória.');
  if (!input.language?.trim()) throw new Error('language é obrigatório.');

  const args: Record<string, unknown> = {
    query: input.query,
    language: input.language,
  };
  if (input.siteId) args.siteId = input.siteId;
  if (typeof input.limit === 'number') args.limit = input.limit;
  if (typeof input.offset === 'number') args.offset = input.offset;

  return callMlMcpTool(input.accountId, 'search_documentation', args);
}

export async function getMlDocumentationPage(
  input: MlMcpGetPageInput,
): Promise<MlMcpCallResult> {
  if (!input.path?.trim()) throw new Error('path é obrigatório.');
  if (!input.language?.trim()) throw new Error('language é obrigatório.');

  const args: Record<string, unknown> = {
    path: input.path,
    language: input.language,
  };
  if (input.siteId) args.siteId = input.siteId;

  return callMlMcpTool(input.accountId, 'get_documentation_page', args);
}

/**
 * Lista as tools expostas pelo MCP do ML (útil para diagnóstico).
 */
export async function listMlMcpTools(accountId?: string): Promise<{
  tools: Array<{ name: string; description?: string }>;
}> {
  const client = await createMlMcpClient(accountId);
  try {
    const list = await client.listTools();
    return {
      tools: list.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    };
  } finally {
    try {
      await client.close();
    } catch (e) {
      console.warn('[ml-mcp] erro ao fechar client (ignorado):', e);
    }
  }
}
