
export interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt?: string;
    mustChangePassword?: boolean;
    lastLogin?: string;
}
