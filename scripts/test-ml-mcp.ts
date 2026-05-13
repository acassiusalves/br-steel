/**
 * Teste manual de conexão com o MCP oficial do Mercado Livre.
 * Rodar:  npx tsx scripts/test-ml-mcp.ts
 *
 * Carrega .env.local, conecta via Firebase Admin para puxar o access_token
 * (com refresh automático), e dispara listTools + search_documentation.
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { listMlMcpTools, searchMlDocumentation } = await import('../src/services/ml-mcp');

  console.log('[1/3] listMlMcpTools ...');
  const tools = await listMlMcpTools();
  console.log('  tools:', JSON.stringify(tools, null, 2));

  console.log('\n[2/3] search_documentation "criar anuncio" (pt_br/MLB) ...');
  const search = await searchMlDocumentation({
    query: 'criar anuncio',
    language: 'pt_br',
    siteId: 'MLB',
    limit: 3,
  });
  console.log('  isError:', (search as any).isError);
  console.log('  content[0].text (primeiros 800 chars):');
  const text = (search.content || []).find((c: any) => typeof c.text === 'string')?.text || '';
  console.log(text.slice(0, 800));

  console.log('\n[3/3] OK — conexão funcionando.');
}

main().catch((e) => {
  console.error('FALHOU:', e);
  process.exit(1);
});
