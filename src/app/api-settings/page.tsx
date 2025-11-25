
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, Save, CheckCircle, XCircle, Plug, Sheet, Database, FileDown, Search, Package, Store, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getBlingCredentials, saveBlingCredentials, disconnectBling, countImportedOrders, getBlingOrderDetails, smartSyncOrders, fullSyncOrders, deleteAllSalesOrders, getBlingProductBySku, getBlingChannelByOrderId, getBlingProducts, diagnoseSku, type SyncProgress } from '@/app/actions';
import { format, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ptBR } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


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

function ApiSettingsContent() {
  const [credentials, setCredentials] = React.useState({ clientId: '', clientSecret: '' });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [callbackUrl, setCallbackUrl] = React.useState('');
  const [authUrl, setAuthUrl] = React.useState('');
  const [isImporting, setIsImporting] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
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
  const [skuToTest, setSkuToTest] = React.useState('');
  const [isFetchingProductBySku, setIsFetchingProductBySku] = React.useState(false);

  const [syncMode, setSyncMode] = React.useState<'smart' | 'period'>('smart');
  const [importSummary, setImportSummary] = React.useState<any>(null);
  const [syncStatusMessage, setSyncStatusMessage] = React.useState<string>('');
  const [syncProgressData, setSyncProgressData] = React.useState<SyncProgress | null>(null);

  // Diagnóstico de SKU
  const [skuToDiagnose, setSkuToDiagnose] = React.useState('CNUL440205140IN');
  const [isDiagnosing, setIsDiagnosing] = React.useState(false);
  const [diagnosisResult, setDiagnosisResult] = React.useState<any>(null);

  const { toast } = useToast();
  
  const loadInitialData = React.useCallback(async () => {
    setIsLoading(true);
    try {
        const [savedCreds, count] = await Promise.all([
            getBlingCredentials(),
            countImportedOrders()
        ]);
        setCredentials(prev => ({ ...prev, clientId: savedCreds.clientId || '', clientSecret: savedCreds.clientSecret || '' }));
        setImportedCount(count);
        setApiStatus(savedCreds.connected ? 'valid' : 'unchecked');

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
            description: "Suas credenciais do Bling foram salvas com sucesso.",
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
        await disconnectBling();
        localStorage.removeItem('bling_oauth_state');
        setAuthUrl('');
        await loadInitialData(); // Recarrega estado real (desconectado)
        toast({ title: 'Desconectado!', description: 'A integração com o Bling foi removida.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro ao Desconectar', description: String(error?.message || error) });
    } finally {
        setIsSaving(false);
    }
  };

  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast({
      title: "Copiado!",
      description: "O texto foi copiado para sua área de transferência.",
    });
  }

  const runSync = async (syncFunction: typeof smartSyncOrders | typeof fullSyncOrders) => {
      setIsImporting(true);
      setApiResponse(null);
      setImportProgress(0);
      setImportStatus({ current: 0, total: 0 });
      setImportSummary(null);
      setSyncStatusMessage('Iniciando sincronização...');
      setSyncProgressData(null);

      // Log inicial no console do browser
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🚀 [SYNC FRONTEND] Iniciando sincronização');
      console.log(`📅 Período: ${date?.from ? format(date.from, 'dd/MM/yyyy') : 'auto'} - ${date?.to ? format(date.to, 'dd/MM/yyyy') : 'auto'}`);
      console.log(`📋 Modo: ${syncFunction === fullSyncOrders ? 'Completa' : 'Inteligente'}`);
      console.log('═══════════════════════════════════════════════════════════');

      const startTime = Date.now();

      // Polling do progresso a cada 500ms usando API route (não Server Action)
      const progressInterval = setInterval(async () => {
          try {
              const response = await fetch('/api/sync-progress', {
                  cache: 'no-store',
                  headers: {
                      'Cache-Control': 'no-cache',
                      'Pragma': 'no-cache',
                  }
              });

              if (response.ok) {
                  const data = await response.json();
                  const progress = data.progress as SyncProgress | null;

                  if (progress && progress.isRunning) {
                      setSyncProgressData(progress);
                      setImportProgress(progress.percentage);
                      setImportStatus({
                          current: progress.currentOrder,
                          total: progress.totalOrders
                      });

                      const elapsed = Math.floor((Date.now() - startTime) / 1000);
                      setSyncStatusMessage(`${progress.currentStep} (${elapsed}s)`);

                      console.log(`📊 [POLL] Progresso: ${progress.percentage}% - ${progress.currentOrder}/${progress.totalOrders} - ${progress.phase}`);
                  }
              }
          } catch (e) {
              console.warn('Erro ao obter progresso:', e);
          }
      }, 500);

      try {
          const result = await syncFunction(date?.from, date?.to);

          clearInterval(progressInterval);

          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log('═══════════════════════════════════════════════════════════');
          console.log(`✅ [SYNC FRONTEND] Sincronização concluída em ${elapsed}s`);
          console.log(`📊 Resultado:`, result.summary);
          console.log('═══════════════════════════════════════════════════════════');

          setSyncStatusMessage(`Sincronização concluída em ${elapsed}s!`);
          setApiResponse(result);
          setImportSummary(result.summary);

          const totalToProcess = result.summary.new || 0;
          setImportStatus({ current: totalToProcess, total: totalToProcess });
          setImportProgress(100);

          const totalCount = await countImportedOrders();
          setImportedCount(totalCount);

          if (result.summary.created === 0 && result.summary.updated === 0) {
              toast({
                  title: "Tudo Atualizado!",
                  description: `Nenhum pedido novo para importar. Total de ${totalCount} na base.`,
              });
          } else {
              toast({
                  title: "Sincronização Concluída!",
                  description: `${result.summary.created} novos, ${result.summary.updated} atualizados. Total: ${totalCount}`,
              });
          }

      } catch (error: any) {
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);

          console.error('═══════════════════════════════════════════════════════════');
          console.error(`❌ [SYNC FRONTEND] Erro após ${elapsed}s:`, error.message);
          console.error('═══════════════════════════════════════════════════════════');

          setSyncStatusMessage(`Erro após ${elapsed}s: ${error.message}`);
          setApiResponse({ error: "Falha na sincronização", message: error.message });
          toast({
              variant: "destructive",
              title: "Erro na Sincronização",
              description: error.message,
          });
      } finally {
          setIsImporting(false);
          setSyncProgressData(null);
      }
  };

  const handleSmartSync = async () => {
    toast({
        title: "Sincronização Inteligente",
        description: "Buscando apenas pedidos novos ou atualizados...",
    });
    await runSync(smartSyncOrders);
  };

  const handleFullSync = async () => {
      toast({
          title: "Sincronização Completa",
          description: "Verificando todos os pedidos no período selecionado...",
      });
      await runSync(fullSyncOrders);
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
  
  const handleFetchProductBySku = async () => {
      if (!skuToTest) {
          toast({ variant: "destructive", title: "SKU Faltando", description: "Por favor, insira um SKU para testar."});
          return;
      }
      setIsFetchingProductBySku(true);
      setApiResponse(null);
      try {
          const responseData = await getBlingProductBySku(skuToTest);
          setApiResponse(responseData);
          toast({ title: "Busca por SKU Concluída", description: "A resposta da API foi recebida."});
      } catch (error: any) {
          setApiResponse({ error: "Falha na requisição", message: error.message });
          toast({
              variant: "destructive",
              title: "Erro na Busca por SKU",
              description: `Não foi possível buscar os dados: ${error.message}`,
          });
      } finally {
          setIsFetchingProductBySku(false);
      }
  }

  const handleDiagnoseSku = async () => {
      if (!skuToDiagnose) {
          toast({ variant: "destructive", title: "SKU Faltando", description: "Por favor, insira um SKU para diagnosticar."});
          return;
      }
      setIsDiagnosing(true);
      setDiagnosisResult(null);
      setApiResponse(null);

      toast({
          title: "Diagnóstico Iniciado",
          description: `Analisando SKU ${skuToDiagnose}. Isso pode levar vários minutos...`,
      });

      console.log('═══════════════════════════════════════════════════════════');
      console.log(`🔍 [DIAGNÓSTICO FRONTEND] Iniciando análise do SKU: ${skuToDiagnose}`);
      console.log('⚠️ Acompanhe o progresso detalhado no terminal do servidor');
      console.log('═══════════════════════════════════════════════════════════');

      try {
          const result = await diagnoseSku(skuToDiagnose);
          setDiagnosisResult(result);
          setApiResponse(result);

          console.log('═══════════════════════════════════════════════════════════');
          console.log('✅ [DIAGNÓSTICO FRONTEND] Análise concluída!');
          console.log(`📊 Firebase: ${result.firebase.ordersCount} pedidos, ${result.firebase.totalQuantity} unidades`);
          console.log(`📊 Bling: ${result.bling.ordersWithSku} pedidos, ${result.bling.totalQuantity} unidades`);
          console.log(`📊 Diferença: ${result.divergence.quantityDiff} unidades`);
          console.log(`📊 Pedidos faltando no Firebase: ${result.divergence.missingOrders}`);
          console.log('═══════════════════════════════════════════════════════════');

          if (result.divergence.missingOrders > 0) {
              toast({
                  variant: "destructive",
                  title: "Divergência Encontrada!",
                  description: `${result.divergence.missingOrders} pedidos do Bling não estão no Firebase. Diferença de ${result.divergence.quantityDiff} unidades.`,
                  duration: 10000,
              });
          } else {
              toast({
                  title: "Diagnóstico Concluído",
                  description: `Todos os pedidos do Bling estão no Firebase. ${result.firebase.totalQuantity} unidades encontradas.`,
              });
          }
      } catch (error: any) {
          console.error('❌ [DIAGNÓSTICO FRONTEND] Erro:', error.message);
          setApiResponse({ error: "Falha no diagnóstico", message: error.message });
          toast({
              variant: "destructive",
              title: "Erro no Diagnóstico",
              description: `Não foi possível completar a análise: ${error.message}`,
          });
      } finally {
          setIsDiagnosing(false);
      }
  }

    const handleDeleteAllOrders = async () => {
        setIsDeleting(true);
        toast({
            title: "Apagando Dados...",
            description: "Esta ação pode demorar alguns instantes. Por favor, aguarde.",
        });
        try {
            const result = await deleteAllSalesOrders();
            toast({
                title: "Sucesso!",
                description: `${result.deletedCount} pedidos foram apagados do banco de dados.`,
            });
            await loadInitialData(); // Re-fetch the count
        } catch (error: any) {
             toast({
                variant: "destructive",
                title: "Erro ao Apagar Dados",
                description: `Não foi possível apagar os pedidos: ${error.message}`,
            });
        } finally {
            setIsDeleting(false);
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
              const last3Months = subDays(today, 89);
              setDate({ from: last3Months, to: today });
              break;
          case 'thisMonth':
              setDate({ from: startOfMonth(today), to: endOfMonth(today) });
              break;
          case 'lastMonth':
              const lastMonthStart = startOfMonth(subDays(startOfMonth(today), 1));
              setDate({ from: lastMonthStart, to: endOfMonth(lastMonthStart) });
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
                                      <div className="text-xs text-muted-foreground">
                                          Evita duplicatas automaticamente
                                      </div>
                                  </div>
                              </div>
                          </SelectItem>
                          <SelectItem value="period">
                              <div className="flex items-center gap-2">
                                  <span role="img" aria-label="calendar">📅</span>
                                  <div className="text-left">
                                      <div>Sincronização Completa</div>
                                      <div className="text-xs text-muted-foreground">
                                          Força verificação de todo período
                                      </div>
                                  </div>
                              </div>
                          </SelectItem>
                      </SelectContent>
                  </Select>
              </div>

              <div className="space-y-2">
                  <Label>Período {syncMode === 'smart' ? '(Opcional)' : ''}</Label>
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
                                  <span>
                                      {syncMode === 'smart' 
                                          ? 'Escolha um período (ou deixe vazio para automático)' 
                                          : 'Escolha um período'
                                      }
                                  </span>
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
                              <Separator />
                              {syncMode === 'smart' && (
                                  <Button variant="ghost" className="justify-start text-left font-normal h-8 px-2" onClick={() => setDate(undefined)}>
                                      <span role="img" aria-label="brain" className="mr-2">🧠</span>
                                      Automático
                                  </Button>
                              )}
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
                  
                  {syncMode === 'smart' && !date?.from && (
                      <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                          <div className="flex items-start gap-2">
                              <span role="img" aria-label="info" className="text-blue-600 mt-0.5">ℹ️</span>
                              <div className="text-xs text-blue-700">
                                  <p className="font-medium mb-1">Modo Automático Ativo</p>
                                  <p>O sistema buscará automaticamente a partir da data do último pedido importado, ou dos últimos 30 dias se for a primeira importação.</p>
                              </div>
                          </div>
                      </div>
                  )}
                  
                  {syncMode === 'smart' && date?.from && (
                      <div className="bg-green-50 border border-green-200 rounded-md p-3">
                          <div className="flex items-start gap-2">
                              <span role="img" aria-label="smart" className="text-green-600 mt-0.5">🎯</span>
                              <div className="text-xs text-green-700">
                                  <p className="font-medium mb-1">Período Personalizado + Inteligente</p>
                                  <p>Verificará apenas pedidos novos no período selecionado, evitando duplicatas.</p>
                              </div>
                          </div>
                      </div>
                  )}
              </div>

              <div className="flex flex-col gap-4">
                  <div className="flex gap-2">
                      {syncMode === 'smart' ? (
                          <Button onClick={handleSmartSync} disabled={isImporting} className="flex-1">
                              {isImporting ? <Loader2 className="animate-spin" /> : <span role="img" aria-label="brain">🧠</span>}
                              {isImporting ? "Sincronizando..." : "Sincronização Inteligente"}
                          </Button>
                      ) : (
                          <Button onClick={handleFullSync} disabled={isImporting || !date?.from} className="flex-1">
                              {isImporting ? <Loader2 className="animate-spin" /> : <Sheet />}
                              {isImporting ? "Sincronizando..." : "Sincronização Completa"}
                          </Button>
                      )}
                      <Button variant="outline" disabled className="flex-1">
                          <FileDown />
                          Exportar Dados
                      </Button>
                  </div>

                  {isImporting && (
                      <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-md">
                          <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                                  <span className="font-medium text-blue-700">Sincronização em andamento</span>
                              </div>
                              {importStatus.total > 0 && (
                                  <span className="text-sm font-bold text-blue-700">
                                      {importStatus.current} / {importStatus.total} pedidos
                                  </span>
                              )}
                          </div>
                          <div className="space-y-1">
                              <Progress value={importProgress} className="h-3" />
                              <div className="flex justify-between text-xs text-blue-600">
                                  <span>{importProgress}%</span>
                                  {syncProgressData?.phase && (
                                      <span className="capitalize">
                                          {syncProgressData.phase === 'listing' && 'Listando pedidos'}
                                          {syncProgressData.phase === 'filtering' && 'Filtrando novos'}
                                          {syncProgressData.phase === 'fetching_details' && 'Buscando detalhes'}
                                          {syncProgressData.phase === 'saving' && 'Salvando'}
                                          {syncProgressData.phase === 'completed' && 'Concluído'}
                                          {syncProgressData.phase === 'error' && 'Erro'}
                                      </span>
                                  )}
                              </div>
                          </div>
                          <p className="text-sm text-blue-600 font-medium">
                              {syncStatusMessage || 'Iniciando...'}
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
                <CardTitle className="text-base">Busca de Produto por SKU</CardTitle>
                <CardDescription>Busque os dados de um produto pelo seu SKU (código).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="skuToTest">SKU do Produto</Label>
                    <Input 
                        id="skuToTest"
                        value={skuToTest}
                        onChange={(e) => setSkuToTest(e.target.value)}
                        placeholder="Ex: PROD-001"
                    />
                  </div>
                  <Button onClick={handleFetchProductBySku} disabled={isFetchingProductBySku}>
                    {isFetchingProductBySku ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando...</>
                    ) : (
                      <><Package className="mr-2 h-4 w-4" /> Buscar por SKU</>
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

            <Card className="bg-amber-50 border-amber-300">
              <CardHeader>
                <CardTitle className="text-base text-amber-800">🔍 Diagnóstico de Divergência por SKU</CardTitle>
                <CardDescription className="text-amber-700">
                  Compare os dados do Firebase com o Bling para identificar pedidos faltando ou divergências de quantidade.
                  <br /><strong>⚠️ Esta operação pode levar vários minutos</strong> pois consulta cada pedido individualmente na API do Bling.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="skuToDiagnose">SKU para Diagnosticar</Label>
                    <Input
                        id="skuToDiagnose"
                        value={skuToDiagnose}
                        onChange={(e) => setSkuToDiagnose(e.target.value)}
                        placeholder="Ex: CNUL440205140IN"
                    />
                  </div>
                  <Button onClick={handleDiagnoseSku} disabled={isDiagnosing} className="bg-amber-600 hover:bg-amber-700">
                    {isDiagnosing ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analisando...</>
                    ) : (
                      <><Search className="mr-2 h-4 w-4" /> Executar Diagnóstico</>
                    )}
                  </Button>
                </div>

                {isDiagnosing && (
                    <div className="p-3 bg-amber-100 border border-amber-300 rounded-md text-sm text-amber-800">
                        <p className="font-medium">⏳ Diagnóstico em andamento...</p>
                        <p className="mt-1">Acompanhe o progresso detalhado no terminal do servidor ou no Console do navegador (F12).</p>
                        <p className="mt-1">Isso pode levar vários minutos dependendo do número de pedidos no período.</p>
                    </div>
                )}

                {diagnosisResult && (
                    <div className="space-y-3 p-4 bg-white border rounded-md">
                        <h4 className="font-semibold text-sm">Resultado do Diagnóstico: {diagnosisResult.sku}</h4>
                        <p className="text-xs text-muted-foreground">Período: {diagnosisResult.period.from} a {diagnosisResult.period.to}</p>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-2">
                                <h5 className="font-medium text-blue-700">📊 Firebase (Local)</h5>
                                <div className="bg-blue-50 p-2 rounded">
                                    <p>Pedidos: <strong>{diagnosisResult.firebase.ordersCount}</strong></p>
                                    <p>Com NF: {diagnosisResult.firebase.ordersWithNF}</p>
                                    <p>Sem NF: {diagnosisResult.firebase.ordersWithoutNF}</p>
                                    <p>Qty Total: <strong>{diagnosisResult.firebase.totalQuantity}</strong></p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h5 className="font-medium text-green-700">🌐 Bling (API)</h5>
                                <div className="bg-green-50 p-2 rounded">
                                    <p>Pedidos no período: {diagnosisResult.bling.totalOrdersInPeriod}</p>
                                    <p>Com este SKU: <strong>{diagnosisResult.bling.ordersWithSku}</strong></p>
                                    <p>Qty Total: <strong>{diagnosisResult.bling.totalQuantity}</strong></p>
                                </div>
                            </div>
                        </div>

                        <div className={`p-3 rounded ${diagnosisResult.divergence.missingOrders > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                            <h5 className={`font-medium ${diagnosisResult.divergence.missingOrders > 0 ? 'text-red-700' : 'text-green-700'}`}>
                                {diagnosisResult.divergence.missingOrders > 0 ? '❌ Divergência Encontrada' : '✅ Dados Sincronizados'}
                            </h5>
                            <p className="text-sm mt-1">
                                Diferença de quantidade: <strong>{diagnosisResult.divergence.quantityDiff}</strong> unidades
                            </p>
                            <p className="text-sm">
                                Pedidos faltando no Firebase: <strong>{diagnosisResult.divergence.missingOrders}</strong>
                            </p>
                            {diagnosisResult.divergence.missingOrderIds.length > 0 && (
                                <div className="mt-2">
                                    <p className="text-xs font-medium">IDs dos pedidos faltando (primeiros 10):</p>
                                    <p className="text-xs text-muted-foreground">
                                        {diagnosisResult.divergence.missingOrderIds.slice(0, 10).join(', ')}
                                        {diagnosisResult.divergence.missingOrderIds.length > 10 && ` ... e mais ${diagnosisResult.divergence.missingOrderIds.length - 10}`}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
              </CardContent>
            </Card>
        </div>

        <Separator />

          <Card className="border-destructive">
            <CardHeader>
                <CardTitle className="text-destructive">Ações de Risco</CardTitle>
                <CardDescription>
                    Cuidado: as ações nesta seção são permanentes e não podem ser desfeitas.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isDeleting || isImporting}>
                            {isDeleting ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Apagando...</>
                            ) : (
                                <><Trash2 className="mr-2 h-4 w-4" /> Apagar Todos os Pedidos</>
                            )}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação é irreversível. Todos os <strong>{importedCount}</strong> pedidos de venda importados serão
                                permanentemente apagados do banco de dados. Os dados no Bling não serão afetados. 
                                Use esta função se precisar forçar uma re-sincronização completa do zero.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteAllOrders} className="bg-destructive hover:bg-destructive/90">
                                Sim, apagar tudo
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                  <p className="text-sm text-muted-foreground mt-2">
                    Use esta função para limpar a base de dados e começar uma nova sincronização do zero.
                </p>
            </CardContent>
          </Card>

        </div>
      );
    }
    
    return (
        <div className="space-y-6">
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
            <Button onClick={handleSaveCredentials} disabled={isSaving}>
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
        </div>
    );
  }

  return (
      <div className="space-y-6">
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
    </div>
  );
}

function ApiSettingsClient() {
  return (
     <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Conexão API</h2>
          <p className="text-muted-foreground">
            Gerencie as configurações de conexão com a API do Bling.
          </p>
        </div>
        <ApiSettingsContent />
      </div>
    </DashboardLayout>
  )
}

export default function ApiSettingsPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando...</div>}>
      <ApiSettingsClient />
    </Suspense>
  );
}
