/**
 * Firestore Admin Service
 *
 * Funções que usam Firebase Admin SDK para serem chamadas em Server Actions e API Routes.
 * Diferente do firestore.ts que usa Client SDK (requer autenticação do usuário).
 */

import { adminDb } from '@/lib/firebase-admin';
import type { MlAccount, MyItem, MercadoLivreCredentials } from '@/lib/types';

/**
 * Carrega todas as contas do Mercado Livre usando Admin SDK
 */
export async function loadMlAccountsAdmin(): Promise<MlAccount[]> {
    console.log('[ADMIN] loadMlAccountsAdmin: Iniciando...');
    try {
        const snapshot = await adminDb.collection('mercadoLivreAccounts').get();
        console.log(`[ADMIN] loadMlAccountsAdmin: Encontradas ${snapshot.docs.length} contas`);
        return snapshot.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                accountName: data.accountName || data.nickname || d.id,
                ...data
            } as MlAccount;
        });
    } catch (error: any) {
        console.error('[ADMIN] loadMlAccountsAdmin ERRO:', error?.message || error);
        console.error('[ADMIN] loadMlAccountsAdmin Stack:', error?.stack);
        throw error;
    }
}

/**
 * Carrega todos os anúncios (My Items) usando Admin SDK
 */
export async function loadMyItemsAdmin(): Promise<MyItem[]> {
    console.log('[ADMIN] loadMyItemsAdmin: Iniciando...');
    try {
        const snapshot = await adminDb
            .collection('anuncios')
            .orderBy('last_updated', 'desc')
            .get();
        console.log(`[ADMIN] loadMyItemsAdmin: Encontrados ${snapshot.docs.length} anúncios`);
        return snapshot.docs.map(d => ({
            ...d.data(),
            id: d.id
        }) as MyItem);
    } catch (error: any) {
        console.error('[ADMIN] loadMyItemsAdmin ERRO:', error?.message || error);
        console.error('[ADMIN] loadMyItemsAdmin Stack:', error?.stack);
        throw error;
    }
}

/**
 * Busca credenciais do Mercado Livre pelo ID da conta usando Admin SDK
 */
export async function getMlCredentialsByIdAdmin(accountId?: string): Promise<MercadoLivreCredentials | null> {
    const accountIdToUse = accountId || "BtAEb2czqoWWZnNwUkRq"; // Usa o ID fixo como fallback
    console.log(`[ADMIN] getMlCredentialsByIdAdmin: Buscando conta ${accountIdToUse}...`);

    if (!accountIdToUse) {
        return null;
    }

    try {
        const docRef = adminDb.collection('mercadoLivreAccounts').doc(accountIdToUse);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            console.log(`[ADMIN] getMlCredentialsByIdAdmin: Encontrada conta ${accountIdToUse}`);
            return docSnap.data() as MercadoLivreCredentials;
        }

        // Se o ID específico não foi encontrado, e não era o fallback, tenta o fallback.
        if (accountId && accountId !== "BtAEb2czqoWWZnNwUkRq") {
            console.log(`[ADMIN] getMlCredentialsByIdAdmin: Tentando fallback...`);
            const fallbackRef = adminDb.collection('mercadoLivreAccounts').doc("BtAEb2czqoWWZnNwUkRq");
            const fallbackSnap = await fallbackRef.get();
            if (fallbackSnap.exists) {
                console.log(`[ADMIN] getMlCredentialsByIdAdmin: Usando fallback`);
                return fallbackSnap.data() as MercadoLivreCredentials;
            }
        }

        throw new Error(`Nenhuma credencial encontrada para a conta ID '${accountIdToUse}' ou para a conta padrão.`);
    } catch (error: any) {
        console.error('[ADMIN] getMlCredentialsByIdAdmin ERRO:', error?.message || error);
        throw error;
    }
}

