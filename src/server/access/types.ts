export type Capability = 'vendas:read' | 'vendas:sync' | 'estoque:read'
  | 'insumos:read' | 'insumos:write' | 'producao:read' | 'producao:write';
export type Actor = { userId: string; role: string; source: 'web' | 'mcp'; clientId?: string };
export type AccessSettings = { permissions: Record<string, string[]>; inactivePages: string[] };
export type AccessContext = AccessSettings & {
  actor: Actor; active: boolean; mustChangePassword?: boolean; capabilities: Capability[];
};
