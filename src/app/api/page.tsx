
"use client";

import * as React from 'react';
import { KeyRound, Loader2, Copy, Save, CheckCircle, XCircle, FileJson, Send, Calendar as CalendarIcon, Plug, Sheet, Database, FileDown, Search, Truck, Package, Store } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, startOfYesterday, endOfYesterday, startOfWeek, endOfWeek, lastDayOfWeek, subWeeks, startOfISOWeek, endOfISOWeek, subMonths, lastDayOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getBlingCredentials, saveBlingCredentials, countImportedOrders, getBlingOrderDetails, getImportedOrderIds, getBlingProducts, getBlingChannelByOrderId, smartSyncOrders, fullSyncOrders } from '@/app/actions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';


type ApiStatus = 'valid' | 'invalid' | 'unchecked';

const ApiStatusBadge = ({ status }: { status: ApiStatus }) => {
    switch (status) {
        case 'valid':
            return <Badge variant="default" className="bg-green-600 hover:bg-green-700"><CheckCircle className="mr-1 h-4 w-4" /> Conectado</Badge>;
        case 'invalid':
            return <Badge variant="destructive"><XCircle className="mr-1 h-4 w-4" /> Inválido</Badge>;
        default:
            return <Badge variant="secondary"><XCircle className="mr-1 h-4 w-4" /> Não Conectado</Badge>;
    }
};


export default function ApiPage() {
  const [credentials, setCredentials] = React.useState({ clientId: '', clientSecret: '', accessToken: '' });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [callbackUrl, setCallbackUrl] = React.useState('');
  const [authUrl, setAuthUrl] = React.useState('');
  const [isImporting, setIsImporting] = React.useState(false);
  const [apiResponse, setApiResponse] = React.useState<any>(null);
  const [date, setDate] = React.useState<DateRange | undefined>(undefined);
  const [apiStatus, setApiStatus] = React.useState<ApiStatus>('unchecked');
  const [importedCount, setImportedCount] = React.useState(0);
  const [importStatus, setImportStatus] = React.useState({ current: 0, total: 0 });
  const [importProgress, setImportProgress] = React.useState(0);
  
  const [isFetchingProducts, setIsFetchingProducts] = React.useState(false);
  const [isFetchingOrderDetails, setIsFetchingOrderDetails] = React.useState(false);
  const [orderIdToTest, setOrderIdToTest] = React.useState('');
  const [isFetchingChannel, setIsFetchingChannel] = React.useState(false);
  const [orderIdForChannel, setOrderIdForChannel] = React.useState('');

  const [syncMode, setSyncMode] = React.useState<'smart' | 'period'>('smart');
  const [importSummary, setImportSummary] = React.useState<any>(null);

  const { toast } = useToast();
  
  const loadInitialData = React.useCallback(async () => {
    setIsLoading(true);
    try {
        const [savedCreds, count] = await Promise.all([
            getBlingCredentials(),
            countImportedOrders()
        ]);
        setCredentials(prev => ({...prev, ...savedCreds}));
        setImportedCount(count);
        if (savedCreds.accessToken) {
            setApiStatus('valid');
        } else {
            setApiStatus('unchecked');
        }

    } catch (error) {
        console.error("Failed to load Bling credentials:", error);
        setApiStatus('invalid');
        toast({
            variant: "destructive",
            title: "Erro ao Carregar",
            description: "Não foi possível carregar as informações de conexão.",
        });
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
        setCallbackUrl(`${window.location.origin}/api/callback/bling`);
        setDate({
            from: startOfMonth(new Date()),
            to: endOfMonth(new Date()),
        });
    }
    loadInitialData();
  }, [loadInitialData]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setCredentials(prev => ({ ...prev, [id]: value }));
  };
  
  const handleSaveCredentials = async () => {
    setIsSaving(true);
    try {
        await saveBlingCredentials({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
        });
        toast({
            title: "Credenciais Salvas!",
            description: "Suas credenciais do Bling foram salvas com sucesso no servidor.",
        });
        const savedCreds = await getBlingCredentials();
        setCredentials(prev => ({...prev, ...savedCreds}));

    } catch (error) {
        toast({
            variant: "destructive",
            title: "Erro ao Salvar",
            description: "Não foi possível salvar as credenciais.",
        });
    } finally {
        setIsSaving(false);
    }
  };

  const handleConnect = () => {
    if (!credentials.clientId) {
        toast({
            variant: "destructive",
            title: "Client ID Faltando",
            description: "Por favor, insira e salve seu Client ID do Bling.",
        });
        return;
    }
    setIsGenerating(true);
    const state = Math.random().toString(36).substring(7);
    localStorage.setItem('bling_oauth_state', state);

    const authorizationUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${credentials.clientId}&state=${state}`;
    
    setAuthUrl(authorizationUrl);
    setIsGenerating(false);
  };

  const handleDisconnect = async () => {
    setIsSaving(true);
    try {
        await saveBlingCredentials({ clientId: '', clientSecret: '', accessToken: '', refreshToken: '' });
        setCredentials({ clientId: '', clientSecret: '', accessToken: '' });
        setApiStatus('unchecked');
        setAuthUrl("");
         toast({
            title: "Desconectado!",
            description: "A integração com o Bling foi removida.",
        });
    } catch (error) {
         toast({
            variant: "destructive",
            title: "Erro ao Desconectar",
            description: "Não foi possível remover a integração.",
        });
    } finally {
        setIsSaving(false);
    }
  }

  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast({
      title: "Copiado!",
      description: "O texto foi copiado para sua área de transferência.",
    });
  }

  const handleSmartSync = async () => {
    setIsImporting(true);
    setApiResponse(null);
    setImportProgress(0);
    setImportStatus({ current: 0, total: 0 });
    setImportSummary(null);

    try {
        toast({
            title: "Sincronização Inteligente",
            description: "Buscando apenas pedidos novos ou atualizados...",
        });

        const result = await smartSyncOrders();
        
        setApiResponse(result);
        setImportSummary(result.summary);

        const totalCount = await countImportedOrders();
        setImportedCount(totalCount);

        if (result.summary.new === 0) {
            toast({
                title: "Tudo Atualizado! ✅",
                description: `Todos os ${result.summary.total} pedidos já estão no banco de dados.`,
            });
        } else {
            toast({
                title: "Sincronização Concluída! 🎉",
                description: `${result.summary.created} novos pedidos importados. Total: ${totalCount}`,
            });
        }

    } catch (error: any) {
        setApiResponse({ error: "Falha na sincronização", message: error.message });
        toast({
            variant: "destructive",
            title: "Erro na Sincronização",
            description: error.message,
        });
    } finally {
        setIsImporting(false);
        setImportProgress(0);
        setImportStatus({ current: 0, total: 0 });
    }
};

const handleFullSync = async () => {
    setIsImporting(true);
    setApiResponse(null);
    setImportProgress(0);
    setImportStatus({ current: 0, total: 0 });
    setImportSummary(null);

    try {
        toast({
            title: "Sincronização Completa",
            description: "Verificando todos os pedidos no período selecionado...",
        });

        const result = await fullSyncOrders(date?.from, date?.to);
        
        setApiResponse(result);
        setImportSummary(result.summary);

        const totalToProcess = result.summary.new;
        for (let i = 0; i <= totalToProcess; i++) {
            const progress = totalToProcess > 0 ? (i / totalToProcess) * 100 : 100;
            setImportProgress(progress);
            setImportStatus({ current: i, total: totalToProcess });
            
            if (i < totalToProcess) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        const totalCount = await countImportedOrders();
        setImportedCount(totalCount);

        toast({
            title: "Sincronização Completa! 🎉",
            description: `${result.summary.created} novos pedidos, ${result.summary.updated} atualizados. Total: ${totalCount}`,
        });

    } catch (error: any) {
        setApiResponse({ error: "Falha na sincronização", message: error.message });
        toast({
            variant: "destructive",
            title: "Erro na Sincronização",
            description: error.message,
        });
    } finally {
        setIsImporting(false);
        setImportProgress(0);
        setImportStatus({ current: 0, total: 0 });
    }
};

  const handleFetchProducts = async () => {
      setIsFetchingProducts(true);
      setApiResponse(null);
      try {
          const responseData = await getBlingProducts();
          setApiResponse(responseData);
          toast({ title: "Busca de Produtos Concluída", description: "A resposta da API foi recebida."});
      } catch (error: any) {
          setApiResponse({ error: "Falha na requisição", message: error.message });
          toast({
              variant: "destructive",
              title: "Erro na Busca de Produtos",
              description: `Não foi possível buscar os dados: ${error.message}`,
          });
      } finally {
          setIsFetchingProducts(false);
      }
  }

  const handleFetchOrderDetails = async () => {
    if (!orderIdToTest) {
        toast({ variant: "destructive", title: "ID do Pedido Faltando", description: "Por favor, insira um ID de pedido para testar."});
        return;
    }
    setIsFetchingOrderDetails(true);
    setApiResponse(null);
    try {
        const responseData = await getBlingOrderDetails(orderIdToTest);
        setApiResponse(responseData);
        toast({ title: "Busca de Detalhes Concluída", description: "A resposta da API foi recebida."});
    } catch (error: any) {
        setApiResponse({ error: "Falha na requisição", message: error.message });
        toast({
            variant: "destructive",
            title: "Erro na Busca de Detalhes",
            description: `Não foi possível buscar os dados: ${error.message}`,
        });
    } finally {
        setIsFetchingOrderDetails(false);
    }
  }

    const handleFetchChannel = async () => {
    if (!orderIdForChannel) {
        toast({ variant: "destructive", title: "ID do Pedido Faltando", description: "Por favor, insira um ID de pedido para testar."});
        return;
    }
    setIsFetchingChannel(true);
    setApiResponse(null);
    try {
        const responseData = await getBlingChannelByOrderId(orderIdForChannel);
        setApiResponse(responseData);
        toast({ title: "Busca de Canal de Venda Concluída", description: "A resposta da API foi recebida."});
    } catch (error: any) {
        setApiResponse({ error: "Falha na requisição", message: error.message });
        toast({
            variant: "destructive",
            title: "Erro na Busca",
            description: `Não foi possível buscar os dados: ${error.message}`,
        });
    } finally {
        setIsFetchingChannel(false);
    }
  }
  
    const setDatePreset = (preset: 'today' | 'yesterday' | 'last7' | 'last30' | 'last3Months' | 'thisMonth' | 'lastMonth') => {
      const today = new Date();
      switch (preset) {
          case 'today':
              setDate({ from: today, to: today });
              break;
          case 'yesterday':
              const yesterday = subDays(today, 1);
              setDate({ from: yesterday, to: yesterday });
              break;
          case 'last7':
              setDate({ from: subDays(today, 6), to: today });
              break;
          case 'last30':
              setDate({ from: subDays(today, 29), to: today });
              break;
          case 'last3Months':
              setDate({ from: subMonths(today, 3), to: today });
              break;
          case 'thisMonth':
              setDate({ from: startOfMonth(today), to: endOfMonth(today) });
              break;
          case 'lastMonth':
              const lastMonthStart = startOfMonth(subMonths(today, 1));
              const lastMonthEnd = endOfMonth(subMonths(today, 1));
              setDate({ from: lastMonthStart, to: lastMonthEnd });
              break;
      }
  }


  const renderConnectionContent = () => {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="m-auto h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    if (apiStatus === 'valid') {
       return (
         <div className="space-y-8">
            <div className="grid md:grid-cols-2 gap-6 items-start">
                 <div className="space-y-4">
                    <div className="flex items-center gap-3 text-left">
                        <CheckCircle className="h-10 w-10 text-green-500 shrink-0" />
                        <div>
                            <p className="font-semibold">Conectado ao Bling</p>
                            <p className="text-sm text-muted-foreground">A integração está ativa e funcionando.</p>
                        </div>
                    </div>
                     <Button onClick={handleDisconnect} variant="destructive" disabled={isSaving}>
                          {isSaving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Desconectando...
                            </>
                          ) : (
                            <>
                              <XCircle className="mr-2 h-4 w-4" />
                              Desconectar
                            </>
                          )}
                        </Button>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Modo de Sincronização</Label>
                        <Select value={syncMode} onValueChange={(value: 'smart' | 'period') => setSyncMode(value)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="smart">
                                    <div className="flex items-center gap-2">
                                        <span role="img" aria-label="brain">🧠</span>
                                        <div className="text-left">
                                            <div>Inteligente (Recomendado)</div>
                                            <div className="text-xs text-muted-foreground">Importa apenas pedidos novos</div>
                                        </div>
                                    </div>
                                </SelectItem>
                                <SelectItem value="period">
                                    <div className="flex items-center gap-2">
                                        <span role="img" aria-label="calendar">📅</span>
                                        <div className="text-left">
                                            <div>Por Período</div>
                                            <div className="text-xs text-muted-foreground">Verifica período selecionado</div>
                                        </div>
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {syncMode === 'period' && (
                        <div className="space-y-2">
                            <Label>Período de Importação</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !date && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date?.from ? (
                                            date.to ? (
                                                <>
                                                    {format(date.from, "dd/MM/yy")} -{" "}
                                                    {format(date.to, "dd/MM/yy")}
                                                </>
                                            ) : (
                                                format(date.from, "dd/MM/yy")
                                            )
                                        ) : (
                                            <span>Escolha um período</span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 flex" align="end">
                                    <div className="flex flex-col space-y-1 p-2 border-r">
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('today')}>Hoje</Button>
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('yesterday')}>Ontem</Button>
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last7')}>Últimos 7 dias</Button>
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last30')}>Últimos 30 dias</Button>
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('last3Months')}>Últimos 3 meses</Button>
                                        <Separator />
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('thisMonth')}>Este mês</Button>
                                        <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDatePreset('lastMonth')}>Mês passado</Button>
                                    </div>
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={date?.from}
                                        selected={date}
                                        onSelect={setDate}
                                        numberOfMonths={2}
                                        locale={ptBR}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    <div className="flex flex-col gap-4">
                        <div className="flex gap-2">
                            {syncMode === 'smart' ? (
                                <Button onClick={handleSmartSync} disabled={isImporting} className="flex-1">
                                    {isImporting ? <Loader2 className="animate-spin" /> : <span role="img" aria-label="brain">🧠</span>}
                                    {isImporting ? "Sincronizando..." : "Sincronização Inteligente"}
                                </Button>
                            ) : (
                                <Button onClick={handleFullSync} disabled={isImporting} className="flex-1">
                                    {isImporting ? <Loader2 className="animate-spin" /> : <Sheet />}
                                    {isImporting ? "Sincronizando..." : "Sincronizar Período"}
                                </Button>
                            )}
                            <Button variant="outline" disabled className="flex-1">
                                <FileDown />
                                Exportar Dados
                            </Button>
                        </div>

                        {isImporting && (
                            <div className="space-y-2">
                                <Progress value={importProgress} />
                                <p className="text-sm text-muted-foreground text-center">
                                    {importStatus.total > 0
                                        ? `Processando ${importStatus.current} de ${importStatus.total} pedidos novos...`
                                        : 'Verificando pedidos existentes...'}
                                </p>
                            </div>
                        )}

                        {importSummary && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                <div className="bg-blue-50 p-2 rounded text-center">
                                    <div className="font-bold text-blue-600">{importSummary.total}</div>
                                    <div className="text-blue-500">Total Encontrado</div>
                                </div>
                                <div className="bg-green-50 p-2 rounded text-center">
                                    <div className="font-bold text-green-600">{importSummary.new}</div>
                                    <div className="text-green-500">Novos</div>
                                </div>
                                <div className="bg-yellow-50 p-2 rounded text-center">
                                    <div className="font-bold text-yellow-600">{importSummary.existing}</div>
                                    <div className="text-yellow-500">Já Existentes</div>
                                </div>
                                <div className="bg-purple-50 p-2 rounded text-center">
                                    <div className="font-bold text-purple-600">{importSummary.created || 0}</div>
                                    <div className="text-purple-500">Importados</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <Separator />

             <div className="space-y-6">
                <h3 className="font-semibold text-lg">Testes de Endpoints</h3>
                 <p className="text-sm text-muted-foreground -mt-4">
                   Use as seções abaixo para fazer chamadas individuais à API do Bling e inspecionar a resposta.
                </p>
                <Card className="bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Detalhes do Pedido</CardTitle>
                    <CardDescription>Busque os dados completos de um pedido específico pelo ID.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="orderIdToTest">ID do Pedido no Bling</Label>
                        <Input 
                            id="orderIdToTest"
                            value={orderIdToTest}
                            onChange={(e) => setOrderIdToTest(e.target.value)}
                            placeholder="Ex: 123456789"
                        />
                      </div>
                      <Button onClick={handleFetchOrderDetails} disabled={isFetchingOrderDetails}>
                        {isFetchingOrderDetails ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando...</>
                        ) : (
                          <><Search className="mr-2 h-4 w-4" /> Buscar Detalhes</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                 <Card className="bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Detalhes do Canal de Venda (Marketplace)</CardTitle>
                    <CardDescription>Busque o nome do marketplace associado a um pedido pelo ID do pedido.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="orderIdForChannel">ID do Pedido no Bling</Label>
                        <Input 
                            id="orderIdForChannel"
                            value={orderIdForChannel}
                            onChange={(e) => setOrderIdForChannel(e.target.value)}
                            placeholder="Ex: 123456789"
                        />
                      </div>
                      <Button onClick={handleFetchChannel} disabled={isFetchingChannel}>
                        {isFetchingChannel ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando...</>
                        ) : (
                          <><Store className="mr-2 h-4 w-4" /> Buscar Canal de Venda</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Lista de Produtos</CardTitle>
                     <CardDescription>Busque os produtos cadastrados no Bling.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={handleFetchProducts} disabled={isFetchingProducts}>
                        {isFetchingProducts ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando...</>
                        ) : (
                          <><Package className="mr-2 h-4 w-4" /> Buscar Produtos</>
                        )}
                    </Button>
                  </CardContent>
                </Card>
            </div>

         </div>
        );
    }
    
    return (
        <div className="flex flex-col items-start gap-6 max-w-lg">
            <div className="w-full space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input 
                id="clientId" 
                type="text"
                placeholder="Cole seu Client ID aqui" 
                value={credentials.clientId}
                onChange={handleInputChange}
            />
            </div>
            <div className="w-full space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input 
                id="clientSecret" 
                type="password"
                placeholder={credentials.clientSecret === '********' ? '********' : 'Cole seu Client Secret aqui'}
                onChange={handleInputChange}
            />
            </div>
            <div className="flex flex-wrap gap-2">
            <Button onClick={handleSaveCredentials} disabled={isSaving || !credentials.clientId || !credentials.clientSecret}>
                {isSaving ? (
                    <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                    </>
                ) : (
                    <>
                    <Save className="mr-2 h-4 w-4" />
                    Salvar Credenciais
                    </>
                )}
            </Button>
            <Button onClick={handleConnect} disabled={isGenerating || !credentials.clientId}>
                {isGenerating ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Gerando...
                </>
                ) : (
                <>
                    <Plug className="mr-2 h-4 w-4" />
                    Gerar Link de Conexão
                </>
                )}
            </Button>
            </div>

            {authUrl && (
            <div className="w-full space-y-2">
                <Label htmlFor="auth-url">1. Link de Autorização</Label>
                <div className="flex items-center gap-2">
                <Input 
                    id="auth-url" 
                    type="text"
                    readOnly
                    value={authUrl}
                    className="bg-muted"
                />
                <Button variant="outline" size="icon" onClick={() => handleCopy(authUrl)}>
                    <Copy className="h-4 w-4" />
                </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                Copie o link acima e cole em um navegador onde você está logado no Bling para autorizar o acesso.
                </p>
            </div>
            )}

            <div className="w-full space-y-2">
            <Label htmlFor="callback-url">2. URL de Callback</Label>
                <div className="flex items-center gap-2">
                    <Input 
                    id="callback-url" 
                    type="text"
                    readOnly
                    value={callbackUrl || 'Carregando...'}
                    className="bg-muted"
                    />
                    <Button variant="outline" size="icon" onClick={() => handleCopy(callbackUrl)}>
                    <Copy className="h-4 w-4" />
                    </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                Certifique-se de que a URL de callback no seu app do Bling está configurada para o valor acima.
                </p>
            </div>
        </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex-1 flex-col gap-8 p-4 pt-6 md:p-8">
        <div>
          <h1 className="text-3xl font-bold">Mapeamento e Conexões</h1>
          <p className="text-muted-foreground">
            Conecte suas fontes de dados para começar a importar e analisar suas vendas.
          </p>
        </div>

        <Tabs defaultValue="bling-api" className="w-full mt-6">
          <TabsList className="grid w-full grid-cols-1 max-w-lg">
            <TabsTrigger value="bling-api"><Database />Bling API (Base)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="bling-api" className="space-y-8 pt-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>Fonte Principal: Bling API</CardTitle>
                        <CardDescription>
                          Conecte sua conta do Bling para sincronizar seus pedidos de venda.
                        </CardDescription>
                    </div>
                     <div className="flex items-center gap-4">
                        {importedCount > 0 && (
                             <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground bg-muted p-2 rounded-md">
                                <Database className="h-4 w-4" />
                                <span>{importedCount} Pedidos já importados</span>
                            </div>
                        )}
                        <ApiStatusBadge status={apiStatus} />
                    </div>
                </div>
              </CardHeader>
              <CardContent>
                {renderConnectionContent()}
              </CardContent>
            </Card>

            {apiResponse && (
              <Card>
                  <CardHeader>
                      <CardTitle>Resposta da API</CardTitle>
                      <CardDescription>
                          Estes são os dados brutos retornados pela última requisição à API do Bling.
                      </CardDescription>
                  </CardHeader>
                  <CardContent>
                      <pre className="p-4 bg-muted rounded-md text-sm overflow-auto max-h-[500px]">
                          <code>{JSON.stringify(apiResponse, null, 2)}</code>
                      </pre>
                  </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
