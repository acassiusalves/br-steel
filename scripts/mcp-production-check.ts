#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateMcpProduction } from './lib/mcp-production-config';
// Inherited environment only. No dotenv, credential-file fallback, or network calls.
try {
 const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
 const result = validateMcpProduction(process.env, config);
 if (result.errors.length) {
  console.error('Production configuration refused:');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
 } else console.log(JSON.stringify({ productionConfiguration: 'valid', ...result.summary }, null, 2));
} catch {
 console.error('Production configuration refused: unreadable or invalid vercel.json.');
 process.exitCode = 1;
}
