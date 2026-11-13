
export interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    active?: boolean;
    createdAt?: string;
    mustChangePassword?: boolean;
    lastLogin?: string;
    /** Código do crachá, nas contas que entram pelo crachá em vez de e-mail. */
    badge?: string;
}
