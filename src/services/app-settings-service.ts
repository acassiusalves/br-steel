"use server";

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AppSettings {
    permissions?: Record<string, string[]>;
    inactivePages?: string[];
}

const settingsDocRef = doc(db, "appSettings", "general");

export async function loadAppSettings(): Promise<AppSettings | null> {
    try {
        const docSnap = await getDoc(settingsDocRef);
        if (docSnap.exists()) {
            return docSnap.data() as AppSettings;
        }
        return null;
    } catch (error) {
        console.error("Erro ao carregar configurações do app:", error);
        throw new Error("Não foi possível carregar as configurações.");
    }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
    try {
        await setDoc(settingsDocRef, settings, { merge: true });
    } catch (error) {
        console.error("Erro ao salvar configurações do app:", error);
        throw new Error("Não foi possível salvar as configurações.");
    }
}
