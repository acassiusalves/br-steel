
"use server";

import { db } from '@/lib/firebase';
import { collection, getDocs, doc, query, where, setDoc, getDoc, addDoc, deleteDoc, orderBy, serverTimestamp, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import type { User } from '@/types/user';


// User Management Actions
export async function getUsers(): Promise<User[]> {
    const usersCollection = collection(db, 'users');
    const q = query(usersCollection, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
        const data = doc.data();
        // Handle both Firestore Timestamp and ISO string
        const createdAt = data.createdAt;
        let isoString: string | undefined;
        if (createdAt instanceof Timestamp) {
            isoString = createdAt.toDate().toISOString();
        } else if (typeof createdAt === 'string') {
            isoString = createdAt;
        }

        return {
            id: doc.id,
            ...data,
            createdAt: isoString,
        } as User;
    });
}


export async function addUser(userData: Omit<User, 'id' | 'createdAt'>): Promise<{ id: string }> {
  const usersCollection = collection(db, 'users');
  // Check for existing user with the same email
  const q = query(usersCollection, where('email', '==', userData.email));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`O e-mail "${userData.email}" já está em uso.`);
  }

  const docRef = await addDoc(usersCollection, {
    ...userData,
    createdAt: new Date().toISOString(), // Use ISO string directly
    mustChangePassword: true, // Force password change on first login
  });
  return { id: docRef.id };
}

export async function deleteUser(userId: string): Promise<void> {
  const userDoc = doc(db, 'users', userId);
  await deleteDoc(userDoc);
}

export async function updateUserRole(userId: string, role: string): Promise<void> {
    const userDocRef = doc(db, 'users', userId);
    try {
        await updateDoc(userDocRef, {
            role: role
        });
    } catch(error) {
        console.error(`Erro ao atualizar a função do usuário ${userId}:`, error);
        throw new Error("Não foi possível atualizar a função do usuário.");
    }
}


// One-time function to seed initial users
export async function seedUsers() {
    const usersToSeed = [
        { name: 'Admin', email: 'admin@brsteel.com', role: 'Administrador' },
        { name: 'Usuário Vendas', email: 'vendas@brsteel.com', role: 'Vendedor' },
        { name: 'Usuário Operador', email: 'operador@brsteel.com', role: 'Operador' },
    ];

    const usersCollection = collection(db, 'users');
    const snapshot = await getDocs(query(usersCollection));
    
    if (snapshot.empty) {
        console.log("Populando coleção de usuários...");
        const batch = writeBatch(db);
        usersToSeed.forEach(user => {
            const docRef = doc(db, 'users', user.email);
            batch.set(docRef, { 
                ...user, 
                createdAt: new Date().toISOString(),
                mustChangePassword: user.role !== 'Administrador'
            });
        });
        await batch.commit();
        console.log("Usuários iniciais cadastrados com sucesso.");
        return { seeded: usersToSeed.length };
    } else {
        console.log("Coleção de usuários já possui dados. Não há necessidade de popular.");
        return { seeded: 0 };
    }
}
