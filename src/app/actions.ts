"use server";

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  predictSalesTrends,
  type PredictSalesTrendsInput,
  type PredictSalesTrendsOutput,
} from "@/ai/flows/predict-sales-trends";

export async function getSalesPrediction(
  input: PredictSalesTrendsInput
): Promise<PredictSalesTrendsOutput> {
  // Simple pass-through to the AI flow.
  // In a real app, you might add more logic here, like authentication,
  // data validation, or logging.
  const prediction = await predictSalesTrends(input);
  return prediction;
}


// Bling API actions
type BlingCredentials = {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
};

const envPath = path.resolve(process.cwd(), '.env');

async function readEnvFile(): Promise<Map<string, string>> {
    try {
        const content = await fs.readFile(envPath, 'utf-8');
        const map = new Map<string, string>();
        content.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key) {
                    map.set(key.trim(), valueParts.join('=').trim());
                }
            }
        });
        return map;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return new Map(); // File doesn't exist yet
        }
        throw error;
    }
}

async function writeEnvFile(envMap: Map<string, string>): Promise<void> {
    let content = '';
    for (const [key, value] of envMap.entries()) {
        content += `${key}=${value}\n`;
    }
    await fs.writeFile(envPath, content, 'utf-8');
}


export async function saveBlingCredentials(credentials: BlingCredentials): Promise<void> {
    const envMap = await readEnvFile();
    if (credentials.clientId) {
        envMap.set('BLING_CLIENT_ID', credentials.clientId);
    }
    if (credentials.clientSecret) {
        envMap.set('BLING_CLIENT_SECRET', credentials.clientSecret);
    }
     if (credentials.accessToken) {
        envMap.set('BLING_ACCESS_TOKEN', credentials.accessToken);
    }
    if (credentials.refreshToken) {
        envMap.set('BLING_REFRESH_TOKEN', credentials.refreshToken);
    }
    await writeEnvFile(envMap);
}

export async function getBlingCredentials(): Promise<Partial<BlingCredentials>> {
    const envMap = await readEnvFile();
    return {
        clientId: envMap.get('BLING_CLIENT_ID') || '',
        clientSecret: envMap.get('BLING_CLIENT_SECRET') ? '********' : '', // Don't expose secret to client
    };
}