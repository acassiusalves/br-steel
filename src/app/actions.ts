"use server";

import * as fs from 'fs/promises';
import * as path from 'path';
import { format } from 'date-fns';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import {
  predictSalesTrends,
  type PredictSalesTrendsInput,
  type PredictSalesTrendsOutput,
} from "@/ai/flows/predict-sales-trends";
import { saveSalesOrders } from '@/services/order-service';

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


export async function saveBlingCredentials(credentials: Partial<BlingCredentials>): Promise<void> {
    const envMap = await readEnvFile();

    // The 'any' cast is a simple way to handle dynamic keys.
    const credentialKeys: (keyof BlingCredentials)[] = ['clientId', 'clientSecret', 'accessToken', 'refreshToken'];
    const envKeys: { [key in keyof BlingCredentials]: string } = {
        clientId: 'BLING_CLIENT_ID',
        clientSecret: 'BLING_CLIENT_SECRET',
        accessToken: 'BLING_ACCESS_TOKEN',
        refreshToken: 'BLING_REFRESH_TOKEN',
    }

    for (const key of credentialKeys) {
        const envVar = envKeys[key];
        const value = credentials[key];

        if (value !== undefined) {
             if (value) {
                envMap.set(envVar, value);
            } else {
                envMap.delete(envVar);
            }
        }
    }
    
    await writeEnvFile(envMap);
}

export async function getBlingCredentials(): Promise<Partial<BlingCredentials>> {
    const envMap = await readEnvFile();
    return {
        clientId: envMap.get('BLING_CLIENT_ID') || '',
        clientSecret: envMap.get('BLING_CLIENT_SECRET') ? '********' : '', // Don't expose secret to client
        accessToken: envMap.get('BLING_ACCESS_TOKEN') ? '********' : '', // Only indicate presence
    };
}

export async function getBlingSalesOrders({ from, to }: { from?: Date, to?: Date } = {}): Promise<any> {
    const envMap = await readEnvFile();
    const accessToken = envMap.get('BLING_ACCESS_TOKEN');

    if (!accessToken) {
        throw new Error('Access Token do Bling não encontrado. Por favor, conecte sua conta primeiro.');
    }

    const url = new URL('https://api.bling.com.br/Api/v3/pedidos/vendas');
    url.searchParams.set('pagina', '1');
    url.searchParams.set('limite', '100'); // Bling's max limit

    if (from) {
        url.searchParams.set('dataInicial', format(from, 'yyyy-MM-dd'));
    }
    if (to) {
        url.searchParams.set('dataFinal', format(to, 'yyyy-MM-dd'));
    }

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
            },
        });

        const data = await response.json();

        if (!response.ok) {
           throw new Error(`Erro do Bling: ${data.error.description || response.statusText}`);
        }
        
        // If the fetch was successful, save the orders to Firestore
        if (data && data.data) {
           const { count } = await saveSalesOrders(data.data);
           console.log(`${count} orders processed.`);
           // We can add the save count to the response if needed
           return { ...data, firestore: { savedCount: count } };
        }

        return data;

    } catch (error: any) {
        // Here, we could also implement the refresh token logic if the token is expired
        console.error('Falha ao buscar pedidos no Bling:', error);
        throw new Error(`Falha na comunicação com a API do Bling: ${error.message}`);
    }
}

export async function countImportedOrders(): Promise<number> {
    try {
        const ordersCollection = collection(db, 'salesOrders');
        const snapshot = await getDocs(ordersCollection);
        return snapshot.size;
    } catch (error) {
        console.error("Failed to count imported orders:", error);
        return 0; // Return 0 if there's an error
    }
}
