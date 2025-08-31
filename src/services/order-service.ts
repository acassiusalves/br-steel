"use server";

import { db } from '@/lib/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';

// We'll use the Bling order ID as the document ID in Firestore
// to prevent duplicates and make it easy to find orders.

/**
 * Saves a batch of sales orders to Firestore.
 * @param orders - An array of sales orders from the Bling API.
 */
export async function saveSalesOrders(orders: any[]): Promise<{ count: number }> {
    if (!orders || orders.length === 0) {
        return { count: 0 };
    }

    const batch = writeBatch(db);
    const ordersCollection = collection(db, 'salesOrders');

    orders.forEach(order => {
        // Use the Bling order ID as the Firestore document ID
        const docRef = doc(ordersCollection, String(order.id)); 
        batch.set(docRef, order);
    });

    await batch.commit();
    console.log(`${orders.length} orders saved to Firestore.`);
    return { count: orders.length };
}
