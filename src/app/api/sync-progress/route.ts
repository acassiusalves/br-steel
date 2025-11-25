import { NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const syncProgressDocRef = doc(db, "appConfig", "syncProgress");

export async function GET() {
    try {
        const snap = await getDoc(syncProgressDocRef);

        if (!snap.exists()) {
            return NextResponse.json({
                progress: null
            }, {
                headers: {
                    'Cache-Control': 'no-store, no-cache, must-revalidate',
                    'Pragma': 'no-cache',
                }
            });
        }

        return NextResponse.json({
            progress: snap.data()
        }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
            }
        });
    } catch (error) {
        console.error('Erro ao obter progresso:', error);
        return NextResponse.json({
            progress: null,
            error: 'Erro ao obter progresso'
        }, {
            status: 500,
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            }
        });
    }
}
