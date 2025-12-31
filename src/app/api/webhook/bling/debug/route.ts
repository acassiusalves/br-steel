import { NextResponse } from 'next/server';
import { collection, getDocs, query, orderBy, limit, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// GET - Lista os últimos webhooks recebidos para debug
export async function GET() {
  try {
    const logsRef = collection(db, 'webhookDebugLogs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(20));
    const snapshot = await getDocs(q);

    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

// DELETE - Limpa os logs de debug
export async function DELETE() {
  try {
    const logsRef = collection(db, 'webhookDebugLogs');
    const snapshot = await getDocs(logsRef);

    let deleted = 0;
    for (const docSnapshot of snapshot.docs) {
      await deleteDoc(doc(db, 'webhookDebugLogs', docSnapshot.id));
      deleted++;
    }

    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
