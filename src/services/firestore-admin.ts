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
 * ID legado mantido apenas como último fallback durante a transição para
 * `appConfig/mlPrimaryAccount`. Pode ser removido após confirmar a migração.
 */
const LEGACY_PRIMARY_ML_ACCOUNT_ID = "BtAEb2czqoWWZnNwUkRq";

/**
 * Lê o ID da conta primária do ML (configurável em `appConfig/mlPrimaryAccount.accountId`).
 * Cai no ID legado se ainda não foi configurada.
 */
export async function getPrimaryMlAccountIdAdmin(): Promise<string> {
    try {
        const snap = await adminDb.collection('appConfig').doc('mlPrimaryAccount').get();
        if (snap.exists) {
            const data = snap.data() as { accountId?: string };
            if (data?.accountId) return data.accountId;
        }
    } catch (e: any) {
        console.warn('[ADMIN] getPrimaryMlAccountIdAdmin: erro lendo config, usando legado.', e?.message);
    }
    return LEGACY_PRIMARY_ML_ACCOUNT_ID;
}

/**
 * Define a conta primária do ML em `appConfig/mlPrimaryAccount`.
 */
export async function setPrimaryMlAccountIdAdmin(accountId: string): Promise<void> {
    await adminDb.collection('appConfig').doc('mlPrimaryAccount').set(
        { accountId, updatedAt: Date.now() },
        { merge: true }
    );
}

/**
 * Persiste credenciais (parcial) de uma conta ML em `mercadoLivreAccounts/{accountId}`
 * usando Admin SDK. Use `merge: true` para não sobrescrever campos não enviados.
 */
export async function saveMlCredentialsAdmin(
    accountId: string,
    partial: Partial<MercadoLivreCredentials>
): Promise<void> {
    if (!accountId) throw new Error('saveMlCredentialsAdmin: accountId é obrigatório');
    const ref = adminDb.collection('mercadoLivreAccounts').doc(accountId);
    await ref.set(partial, { merge: true });
}

/**
 * Busca credenciais do Mercado Livre pelo ID da conta usando Admin SDK.
 * Se nenhum ID for passado, usa a conta primária configurada em `appConfig/mlPrimaryAccount`.
 */
export async function getMlCredentialsByIdAdmin(accountId?: string): Promise<MercadoLivreCredentials | null> {
    const accountIdToUse = accountId || await getPrimaryMlAccountIdAdmin();
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

        // Se o ID específico não foi encontrado, e não era a primária, tenta a primária.
        const primaryId = await getPrimaryMlAccountIdAdmin();
        if (accountId && accountId !== primaryId) {
            console.log(`[ADMIN] getMlCredentialsByIdAdmin: Tentando conta primária ${primaryId}...`);
            const primaryRef = adminDb.collection('mercadoLivreAccounts').doc(primaryId);
            const primarySnap = await primaryRef.get();
            if (primarySnap.exists) {
                console.log(`[ADMIN] getMlCredentialsByIdAdmin: Usando conta primária`);
                return primarySnap.data() as MercadoLivreCredentials;
            }
        }

        throw new Error(`Nenhuma credencial encontrada para a conta ID '${accountIdToUse}' ou para a conta primária.`);
    } catch (error: any) {
        console.error('[ADMIN] getMlCredentialsByIdAdmin ERRO:', error?.message || error);
        throw error;
    }
}

