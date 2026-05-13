'use client';

import * as React from 'react';
import { Suspense } from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Loader2, BookOpen, ExternalLink, FileText, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
    listMlAccounts,
    mlDocsSearch,
    mlDocsGetPage,
    type MlAccountSummary,
} from '@/app/actions';

const LANGUAGES: Array<{ value: string; label: string }> = [
    { value: 'pt_br', label: 'Português (BR)' },
    { value: 'es_ar', label: 'Espanhol (AR)' },
    { value: 'en_us', label: 'Inglês (US)' },
];

const SITE_IDS: Array<{ value: string; label: string }> = [
    { value: 'MLB', label: 'MLB — Brasil' },
    { value: 'MLA', label: 'MLA — Argentina' },
    { value: 'MLM', label: 'MLM — México' },
    { value: 'MLC', label: 'MLC — Chile' },
    { value: 'MCO', label: 'MCO — Colômbia' },
    { value: 'MLU', label: 'MLU — Uruguai' },
    { value: 'MPE', label: 'MPE — Peru' },
];

const NONE_SITE = '__none__';

/**
 * Tenta normalizar a resposta do MCP em uma lista de itens "linkáveis".
 * O MCP retorna `content: [{ type: 'text', text: '...' }]`; muitas vezes o
 * texto é JSON serializado ou markdown. Tentamos parsear como JSON; se falhar,
 * mostramos o texto bruto como único item.
 */
type ParsedItem = {
    title?: string;
    path?: string;
    description?: string;
    snippet?: string;
    raw?: string;
};

function parseSearchResult(result: any): { items: ParsedItem[]; rawText: string } {
    const content = Array.isArray(result?.content) ? result.content : [];
    const textParts = content
        .filter((c: any) => c && typeof c === 'object' && typeof c.text === 'string')
        .map((c: any) => c.text as string);
    const rawText = textParts.join('\n\n');

    // 1) Tenta JSON estruturado.
    if (result?.structuredContent && typeof result.structuredContent === 'object') {
        const sc: any = result.structuredContent;
        const list = sc.results ?? sc.items ?? sc.documents ?? sc;
        if (Array.isArray(list)) {
            return { items: list.map(normalizeItem), rawText };
        }
    }

    // 2) Tenta parsear o texto como JSON.
    for (const t of textParts) {
        try {
            const j = JSON.parse(t);
            const list = j?.results ?? j?.items ?? j?.documents ?? (Array.isArray(j) ? j : null);
            if (Array.isArray(list)) {
                return { items: list.map(normalizeItem), rawText };
            }
        } catch {
            // ignora — não era JSON
        }
    }

    // 3) Fallback: texto bruto como único item.
    if (rawText.trim()) {
        return { items: [{ snippet: rawText, raw: rawText }], rawText };
    }
    return { items: [], rawText };
}

function normalizeItem(it: any): ParsedItem {
    if (!it || typeof it !== 'object') return { raw: String(it) };
    return {
        title: it.title || it.name || it.heading,
        path: it.path || it.url || it.id || it.slug,
        description: it.description || it.summary,
        snippet: it.snippet || it.excerpt || it.preview,
        raw: typeof it === 'string' ? it : undefined,
    };
}

function extractPageText(result: any): string {
    const content = Array.isArray(result?.content) ? result.content : [];
    return content
        .filter((c: any) => c && typeof c === 'object' && typeof c.text === 'string')
        .map((c: any) => c.text as string)
        .join('\n\n');
}

function MlDocsContent() {
    const { toast } = useToast();

    const [accounts, setAccounts] = React.useState<MlAccountSummary[]>([]);
    const [accountId, setAccountId] = React.useState<string | undefined>();
    const [loadingAccounts, setLoadingAccounts] = React.useState(true);

    const [query, setQuery] = React.useState('');
    const [language, setLanguage] = React.useState('pt_br');
    const [siteId, setSiteId] = React.useState<string>('MLB');
    const [limit, setLimit] = React.useState<number>(10);

    const [isSearching, setIsSearching] = React.useState(false);
    const [items, setItems] = React.useState<ParsedItem[]>([]);
    const [rawText, setRawText] = React.useState<string>('');
    const [searchError, setSearchError] = React.useState<string | null>(null);

    const [pageDialogOpen, setPageDialogOpen] = React.useState(false);
    const [pageLoading, setPageLoading] = React.useState(false);
    const [pageTitle, setPageTitle] = React.useState<string>('');
    const [pageText, setPageText] = React.useState<string>('');

    // Carrega contas ao montar
    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const list = await listMlAccounts();
                if (!alive) return;
                setAccounts(list);
                const primary = list.find((a) => a.isPrimary) || list[0];
                if (primary) setAccountId(primary.accountId);
            } catch (e: any) {
                toast({ variant: 'destructive', title: 'Falha ao listar contas ML', description: e?.message ?? 'erro' });
            } finally {
                if (alive) setLoadingAccounts(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [toast]);

    const handleSearch = React.useCallback(async () => {
        if (!query.trim()) {
            toast({ title: 'Informe um termo', description: 'Digite o que deseja buscar na doc do Mercado Livre.' });
            return;
        }
        setIsSearching(true);
        setItems([]);
        setRawText('');
        setSearchError(null);
        try {
            const res = await mlDocsSearch({
                accountId,
                query: query.trim(),
                language,
                siteId: siteId === NONE_SITE ? undefined : siteId,
                limit,
            });
            if (!res.ok) {
                setSearchError(res.error);
                toast({ variant: 'destructive', title: 'Erro na busca', description: res.error });
                return;
            }
            const parsed = parseSearchResult(res.data);
            setItems(parsed.items);
            setRawText(parsed.rawText);
            if (parsed.items.length === 0) {
                toast({ title: 'Sem resultados', description: 'A busca não retornou itens.' });
            }
        } catch (e: any) {
            setSearchError(e?.message ?? 'erro');
            toast({ variant: 'destructive', title: 'Erro inesperado', description: e?.message ?? 'erro' });
        } finally {
            setIsSearching(false);
        }
    }, [accountId, query, language, siteId, limit, toast]);

    const handleOpenPage = React.useCallback(
        async (item: ParsedItem) => {
            if (!item.path) {
                toast({ variant: 'destructive', title: 'Item sem path', description: 'Este resultado não possui um path para abrir.' });
                return;
            }
            setPageDialogOpen(true);
            setPageLoading(true);
            setPageTitle(item.title || item.path);
            setPageText('');
            try {
                const res = await mlDocsGetPage({
                    accountId,
                    path: item.path,
                    language,
                    siteId: siteId === NONE_SITE ? undefined : siteId,
                });
                if (!res.ok) {
                    toast({ variant: 'destructive', title: 'Erro ao buscar página', description: res.error });
                    setPageText(`Erro: ${res.error}`);
                    return;
                }
                setPageText(extractPageText(res.data) || '(página vazia)');
            } catch (e: any) {
                setPageText(`Erro: ${e?.message ?? 'falha desconhecida'}`);
            } finally {
                setPageLoading(false);
            }
        },
        [accountId, language, siteId, toast],
    );

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        void handleSearch();
    };

    const hasAccount = !!accountId;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5" /> Buscar na Documentação Oficial
                    </CardTitle>
                    <CardDescription>
                        Pesquisa em tempo real na documentação técnica do Mercado Livre via MCP oficial
                        (<code className="text-xs">mcp.mercadolibre.com</code>). Usa o token OAuth da conta selecionada.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                            <div className="md:col-span-4">
                                <Label htmlFor="ml-docs-account">Conta ML</Label>
                                {loadingAccounts ? (
                                    <Skeleton className="mt-1 h-10 w-full" />
                                ) : accounts.length === 0 ? (
                                    <div className="mt-1 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                                        <AlertCircle className="h-4 w-4" /> Nenhuma conta conectada. Conecte em
                                        <a href="/api-settings" className="ml-1 underline">/api-settings</a>.
                                    </div>
                                ) : (
                                    <Select value={accountId} onValueChange={setAccountId}>
                                        <SelectTrigger id="ml-docs-account" className="mt-1">
                                            <SelectValue placeholder="Selecione uma conta" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {accounts.map((a) => (
                                                <SelectItem key={a.accountId} value={a.accountId}>
                                                    {(a.nickname || a.accountName || a.userId || a.accountId)}
                                                    {a.isPrimary ? ' (primária)' : ''}
                                                    {a.apiStatus === 'invalid' ? ' — inválida' : ''}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>

                            <div className="md:col-span-3">
                                <Label htmlFor="ml-docs-language">Idioma</Label>
                                <Select value={language} onValueChange={setLanguage}>
                                    <SelectTrigger id="ml-docs-language" className="mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LANGUAGES.map((l) => (
                                            <SelectItem key={l.value} value={l.value}>
                                                {l.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="md:col-span-3">
                                <Label htmlFor="ml-docs-site">Site (país)</Label>
                                <Select value={siteId} onValueChange={setSiteId}>
                                    <SelectTrigger id="ml-docs-site" className="mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NONE_SITE}>Todos</SelectItem>
                                        {SITE_IDS.map((s) => (
                                            <SelectItem key={s.value} value={s.value}>
                                                {s.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="md:col-span-2">
                                <Label htmlFor="ml-docs-limit">Limite</Label>
                                <Input
                                    id="ml-docs-limit"
                                    className="mt-1"
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={limit}
                                    onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 md:flex-row">
                            <Input
                                placeholder="Ex.: criar anúncio, webhooks, kit de envio..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                disabled={!hasAccount}
                            />
                            <Button type="submit" disabled={!hasAccount || isSearching || !query.trim()}>
                                {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                Buscar
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {searchError && (
                <Card className="border-destructive/50">
                    <CardContent className="pt-6 text-sm text-destructive">{searchError}</CardContent>
                </Card>
            )}

            {isSearching && (
                <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full" />
                    ))}
                </div>
            )}

            {!isSearching && items.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">{items.length} resultado(s)</h3>
                        <Badge variant="secondary">{language}{siteId && siteId !== NONE_SITE ? ` · ${siteId}` : ''}</Badge>
                    </div>
                    {items.map((item, i) => (
                        <Card key={`${item.path ?? 'raw'}-${i}`}>
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    <span>{item.title || item.path || `Resultado ${i + 1}`}</span>
                                </CardTitle>
                                {item.path && (
                                    <CardDescription className="font-mono text-xs">{item.path}</CardDescription>
                                )}
                            </CardHeader>
                            <CardContent className="pb-3">
                                {(item.description || item.snippet) && (
                                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                                        {item.description || item.snippet}
                                    </p>
                                )}
                            </CardContent>
                            <CardFooter>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!item.path}
                                    onClick={() => handleOpenPage(item)}
                                >
                                    <ExternalLink className="mr-2 h-4 w-4" /> Abrir página completa
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

            {!isSearching && items.length === 0 && rawText && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Resposta bruta</CardTitle>
                        <CardDescription>O MCP retornou texto não estruturado.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{rawText}</pre>
                    </CardContent>
                </Card>
            )}

            <Dialog open={pageDialogOpen} onOpenChange={setPageDialogOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="break-all">{pageTitle}</DialogTitle>
                        <DialogDescription>Conteúdo retornado por <code>get_documentation_page</code>.</DialogDescription>
                    </DialogHeader>
                    {pageLoading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-2/3" />
                        </div>
                    ) : (
                        <ScrollArea className="h-[60vh] rounded-md border bg-muted/30 p-4">
                            <pre className="whitespace-pre-wrap text-sm leading-relaxed">{pageText}</pre>
                        </ScrollArea>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function MlDocsClient() {
    return (
        <DashboardLayout>
            <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Documentação Mercado Livre</h2>
                    <p className="text-muted-foreground">
                        Pesquise na documentação oficial do Mercado Livre via servidor MCP.
                    </p>
                </div>
                <MlDocsContent />
            </div>
        </DashboardLayout>
    );
}

export default function MlDocsPage() {
    return (
        <Suspense fallback={<div className="p-4">Carregando...</div>}>
            <MlDocsClient />
        </Suspense>
    );
}
