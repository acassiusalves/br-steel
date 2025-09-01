
"use client";

import * as React from 'react';
import { KeyRound, Loader2, Copy, Save, CheckCircle, XCircle, FileJson, Send, Calendar as CalendarIcon, Plug, Sheet, Database, FileDown, Search } from 'lucide-react';
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { startOfMonth, endOfMonth } from 'date-fns';

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getBlingCredentials, saveBlingCredentials, getBlingSalesOrders, countImportedOrders, getBlingOrderDetails, getImportedOrderIds } from '@/app/actions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
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
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [apiStatus, setApiStatus] = React.useState<ApiStatus>('unchecked');
  const [importedCount, setImportedCount] = React.useState(0);
  const [importStatus, setImportStatus] = React.useState({ current: 0, total: 0 });
  const [importProgress, setImportProgress] = React.useState(0);
  
  const { toast } = useToast();
  
  // Combina o carregamento inicial de credenciais e a contagem de pedidos
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

  const handleImportSales = async () => {
    setIsImporting(true);
    setApiResponse(null);
    setImportProgress(0);
    setImportStatus({ current: 0, total: 0 });

    try {
      const responseData = await getBlingSalesOrders({ from: date?.from, to: date?.to });
      setApiResponse(responseData);

      // Busca os IDs dos pedidos já enriquecidos do Firestore
      const enrichedOrderIds = await getImportedOrderIds();

      // Filtra pedidos que ainda não foram enriquecidos
      const ordersToEnrich = (responseData?.data || []).filter((order: any) => !enrichedOrderIds.has(String(order.id)));
      
      const totalOrdersToEnrich = ordersToEnrich.length;
      setImportStatus({ current: 0, total: totalOrdersToEnrich });

      if (totalOrdersToEnrich > 0) {
          toast({
              title: "Enriquecendo Pedidos...",
              description: `Buscando detalhes para ${totalOrdersToEnrich} novo(s) pedido(s). Isso pode levar um momento.`,
          });

          for (let i = 0; i < totalOrdersToEnrich; i++) {
              const order = ordersToEnrich[i];
              try {
                  await getBlingOrderDetails(String(order.id));
                  console.log(`Detalhes do pedido ${order.id} salvos com sucesso.`);
              } catch (detailError: any) {
                  console.error(`Falha ao buscar detalhes para o pedido ${order.id}:`, detailError.message);
                  // Opcional: notificar sobre falha em pedido específico
              }
              const progress = ((i + 1) / totalOrdersToEnrich) * 100;
              setImportProgress(progress);
              setImportStatus(prev => ({ ...prev, current: i + 1 }));
          }
           toast({
              title: "Enriquecimento Concluído!",
              description: `Os detalhes de ${totalOrdersToEnrich} pedido(s) foram salvos.`,
          });
      } else {
           toast({
              title: "Nenhuma Atualização Necessária",
              description: "Todos os pedidos importados já possuem detalhes.",
          });
      }
     
      const totalCount = await countImportedOrders();
      setImportedCount(totalCount);
      
      toast({
        title: "Sincronização Concluída!",
        description: `Seus pedidos foram importados/atualizados. Total no banco de dados: ${totalCount}`,
      });


    } catch (error: any) {
      setApiResponse({ error: "Falha na requisição", message: error.message });
      toast({
        variant: "destructive",
        title: "Erro na Importação",
        description: `Não foi possível buscar os dados do Bling: ${error.message}`,
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
      setImportStatus({ current: 0, total: 0 });
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
    
    // Se estiver conectado, mostra a área de importação e desconexão
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
                          <PopoverContent className="w-auto p-0" align="end">
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
                    <div className="flex flex-col gap-4">
                        <div className="flex gap-2">
                            <Button onClick={handleImportSales} disabled={isImporting} className="flex-1">
                                {isImporting ? <Loader2 className="animate-spin" /> : <Sheet />}
                                {isImporting ? "Sincronizando..." : "Importar/Atualizar Vendas"}
                            </Button>
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
                                ? `Enriquecendo ${importStatus.current} de ${importStatus.total} pedidos...`
                                : 'Buscando lista de pedidos...'}
                            </p>
                          </div>
                        )}
                    </div>
                </div>
            </div>
            
            <Separator />

         </div>
        );
    }
    
    // Se não estiver conectado, mostra o formulário de conexão
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
                      <CardTitle>Resposta da API de Lista de Pedidos</CardTitle>
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

    