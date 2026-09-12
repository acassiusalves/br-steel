#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateMcpStaging } from './lib/mcp-staging-config';
// Validate the file uploaded at the project root, not the separate staging template.
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const result = validateMcpStaging(process.env, config);
if (result.errors.length) {
 console.error('Configuração de homologação recusada:');
 for (const error of result.errors) console.error(`- ${error}`);
 process.exitCode = 1;
} else console.log(JSON.stringify({ stagingConfiguration: 'valid', ...result.summary }, null, 2));
