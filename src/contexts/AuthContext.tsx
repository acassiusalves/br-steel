"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { pagePermissions } from '@/lib/permissions';
import type { User } from '@/types/user';

interface AuthContextType {
    user: User | null;
    permissions: Record<string, string[]>;
    inactivePages: string[];
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }>;
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

    // Carrega dados do localStorage ao montar e confirma a sessão HttpOnly no servidor.
    useEffect(() => {
        const loadFromStorage = async () => {
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

                const response = await fetch('/api/auth/me', { cache: 'no-store' });
                if (response.ok) {
                    const data = await response.json();
                    if (data?.ok && data?.user) {
                        setUser(data.user);
                        setPermissions(data.permissions || pagePermissions);
                        setInactivePages(data.inactivePages || []);
                        setIsAuthenticated(true);
                        saveToStorage(data.user, data.permissions || pagePermissions, data.inactivePages || []);
                    }
                } else {
                    setUser(null);
                    setIsAuthenticated(false);
                    clearStorage();
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

    const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }> => {
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.ok) {
                return { success: false, error: data?.error || 'Usuário ou senha inválidos' };
            }

            // Salva no state
            setUser(data.user);
            setPermissions(data.permissions || pagePermissions);
            setInactivePages(data.inactivePages || []);
            setIsAuthenticated(true);

            // Salva no localStorage para persistência
            saveToStorage(data.user, data.permissions || pagePermissions, data.inactivePages || []);

            return {
                success: true,
                mustChangePassword: data.user?.mustChangePassword
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
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    }, []);

    const refreshPermissions = useCallback(async () => {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
            setPermissions(pagePermissions);
            setInactivePages([]);
            localStorage.setItem(STORAGE_KEYS.permissions, JSON.stringify(pagePermissions));
            localStorage.setItem(STORAGE_KEYS.inactivePages, JSON.stringify([]));
            return;
        }

        const appPerms = data.permissions || pagePermissions;
        const inactive = data.inactivePages || [];
        setPermissions(appPerms);
        setInactivePages(inactive);
        if (data.user) setUser(data.user);

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
