export type OperationSource = 'firestore' | 'postgres' | 'bling' | 'cache' | 'webhook' | 'mixed' | 'unavailable';
export interface OperationResult<T> { data: T; source: OperationSource; asOf: string; warnings: string[]; nextCursor: string | null; }
