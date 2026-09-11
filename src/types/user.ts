
export interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    active?: boolean;
    createdAt?: string;
    mustChangePassword?: boolean;
    lastLogin?: string;
}
