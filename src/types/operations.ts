export type OperationSource = 'firestore' | 'postgres' | 'bling' | 'cache' | 'webhook' | 'mixed' | 'unavailable';
export interface ReadCopy { mode: 'pilot'; sourceProject: string; snapshotHash: string; capturedAt: string; completedAt: string; }
export interface OperationResult<T> { data: T; source: OperationSource; asOf: string; warnings: string[]; nextCursor: string | null; readCopy?: ReadCopy; }
