"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { pagePermissions } from '@/lib/permissions';
import type { User } from '@/types/user';

interface AuthContextType {
    user: User | null;
    permissions: Record<string, string[]>;
    inactivePages: string[];
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string) => Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }>;
    logout: () => void;
    refreshPermissions: () => Promise<void>;
    updateUser: (userData: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Chaves do localStorage
const STORAGE_KEYS = {
    isAuthenticated: 'isAuthenticated',
    userEmail: 'userEmail',
    userData: 'userData',
    permissions: 'permissions',
    inactivePages: 'inactivePages',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [permissions, setPermissions] = useState<Record<string, string[]>>(pagePermissions);
    const [inactivePages, setInactivePages] = useState<string[]>([]);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Carrega dados do localStorage ao montar (rehidratação)
    useEffect(() => {
        const loadFromStorage = () => {
            try {
                const storedAuth = localStorage.getItem(STORAGE_KEYS.isAuthenticated);
                const storedUser = localStorage.getItem(STORAGE_KEYS.userData);
                const storedPermissions = localStorage.getItem(STORAGE_KEYS.permissions);
                const storedInactivePages = localStorage.getItem(STORAGE_KEYS.inactivePages);

                if (storedAuth === 'true' && storedUser) {
                    setIsAuthenticated(true);
                    setUser(JSON.parse(storedUser));

                    if (storedPermissions) {
                        setPermissions(JSON.parse(storedPermissions));
                    }
                    if (storedInactivePages) {
                        setInactivePages(JSON.parse(storedInactivePages));
                    }
                }
            } catch (error) {
                console.error('Erro ao carregar dados do localStorage:', error);
                // Em caso de erro, limpa tudo
                clearStorage();
            } finally {
                setIsLoading(false);
            }
        };

        loadFromStorage();
    }, []);

    const clearStorage = () => {
        Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    };

    const saveToStorage = (userData: User, perms: Record<string, string[]>, inactive: string[]) => {
        localStorage.setItem(STORAGE_KEYS.isAuthenticated, 'true');
        localStorage.setItem(STORAGE_KEYS.userEmail, userData.email);
        localStorage.setItem(STORAGE_KEYS.userData, JSON.stringify(userData));
        localStorage.setItem(STORAGE_KEYS.permissions, JSON.stringify(perms));
        localStorage.setItem(STORAGE_KEYS.inactivePages, JSON.stringify(inactive));
    };

    const fetchAppSettings = async (): Promise<{ permissions: Record<string, string[]>; inactivePages: string[] }> => {
        try {
            const settingsRef = doc(db, "appSettings", "general");
            const docSnap = await getDoc(settingsRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                return {
                    permissions: data.permissions || pagePermissions,
                    inactivePages: data.inactivePages || [],
                };
            }
        } catch (error) {
            console.error('Erro ao carregar appSettings:', error);
        }

        return { permissions: pagePermissions, inactivePages: [] };
    };

    const login = useCallback(async (email: string): Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }> => {
        try {
            // Busca usuário no Firebase
            const userQuery = query(collection(db, "users"), where("email", "==", email));
            const userSnapshot = await getDocs(userQuery);

            if (userSnapshot.empty) {
                return { success: false, error: 'Usuário não encontrado' };
            }

            const userDoc = userSnapshot.docs[0];
            const userData = { id: userDoc.id, ...userDoc.data() } as User;

            // Atualiza último login
            await updateDoc(userDoc.ref, { lastLogin: new Date().toISOString() });

            // Busca permissões (em paralelo se possível, mas aqui já temos o user)
            const { permissions: appPerms, inactivePages: inactive } = await fetchAppSettings();

            // Salva no state
            setUser(userData);
            setPermissions(appPerms);
            setInactivePages(inactive);
            setIsAuthenticated(true);

            // Salva no localStorage para persistência
            saveToStorage(userData, appPerms, inactive);

            return {
                success: true,
                mustChangePassword: userData.mustChangePassword
            };
        } catch (error) {
            console.error('Erro no login:', error);
            return { success: false, error: 'Erro ao fazer login' };
        }
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        setPermissions(pagePermissions);
        setInactivePages([]);
        setIsAuthenticated(false);
        clearStorage();
    }, []);

    const refreshPermissions = useCallback(async () => {
        const { permissions: appPerms, inactivePages: inactive } = await fetchAppSettings();
        setPermissions(appPerms);
        setInactivePages(inactive);

        // Atualiza localStorage
        localStorage.setItem(STORAGE_KEYS.permissions, JSON.stringify(appPerms));
        localStorage.setItem(STORAGE_KEYS.inactivePages, JSON.stringify(inactive));
    }, []);

    const updateUser = useCallback((userData: Partial<User>) => {
        setUser(prev => {
            if (!prev) return prev;
            const updated = { ...prev, ...userData };
            localStorage.setItem(STORAGE_KEYS.userData, JSON.stringify(updated));
            return updated;
        });
    }, []);

    const value: AuthContextType = {
        user,
        permissions,
        inactivePages,
        isAuthenticated,
        isLoading,
        login,
        logout,
        refreshPermissions,
        updateUser,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth deve ser usado dentro de um AuthProvider');
    }
    return context;
}
