/**
 * Atualiza o AUTH_HEADER do servidor MCP `mercadolibre-mcp-server`
 * registrado em ~/.claude.json (projects.<cwd>.mcpServers) com um
 * access_token fresco obtido via getMlToken().
 *
 * Uso: npx tsx scripts/refresh-claude-ml-token.ts
 *
 * Depois de rodar, reinicie o Claude Code para o MCP recarregar.
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// silenciar logs informativos
const _origLog = console.log;
console.log = (...args: unknown[]) => console.error(...args);

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');
const PROJECT_PATH = process.cwd();
const SERVER_KEY = 'mercadolibre-mcp-server';

async function main() {
  const { getMlToken } = await import('../src/services/mercadolivre');

  _origLog('→ obtendo token fresco do Mercado Livre…');
  const token = await getMlToken();
  if (!token || typeof token !== 'string') {
    throw new Error('getMlToken() não retornou um token válido');
  }
  _origLog(`→ token obtido (${token.length} chars).`);

  _origLog(`→ lendo ${CLAUDE_JSON}…`);
  const raw = await fs.readFile(CLAUDE_JSON, 'utf8');
  const data = JSON.parse(raw);

  const projects = (data.projects = data.projects || {});
  const proj = (projects[PROJECT_PATH] = projects[PROJECT_PATH] || {});

  // mcpServers pode vir como [] do Claude Code — normalizamos para objeto
  if (!proj.mcpServers || Array.isArray(proj.mcpServers)) {
    proj.mcpServers = {};
  }

  const server = (proj.mcpServers[SERVER_KEY] = proj.mcpServers[SERVER_KEY] || {
    command: 'npx',
    args: [
      '-y',
      'mcp-remote',
      'https://mcp.mercadolibre.com/mcp',
      '--header',
      'Authorization:${AUTH_HEADER}',
      '--transport',
      'http-first',
    ],
    env: {},
  });
  server.env = server.env || {};

  const prev = server.env.AUTH_HEADER;
  const next = `Bearer ${token}`;
  if (prev === next) {
    _origLog('✓ token já está atualizado — nada a fazer.');
    return;
  }

  server.env.AUTH_HEADER = next;

  // backup defensivo
  const backupPath = `${CLAUDE_JSON}.bak-${Date.now()}`;
  await fs.writeFile(backupPath, raw, 'utf8');

  await fs.writeFile(CLAUDE_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');

  _origLog(`✓ AUTH_HEADER atualizado em ${CLAUDE_JSON}`);
  _origLog(`  projeto: ${PROJECT_PATH}`);
  _origLog(`  backup: ${backupPath}`);
  _origLog('  Reinicie o Claude Code para recarregar o MCP.');
}

main().catch((e) => {
  console.error('FALHOU:', e?.message || e);
  process.exit(1);
});
