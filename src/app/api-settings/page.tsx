
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, Save, CheckCircle, XCircle, Plug, Sheet, Database, Trash2, KeyRound, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getBlingCredentials, saveBlingCredentials, disconnectBling, countImportedOrders, smartSyncOrders, fullSyncOrders, deleteAllSalesOrders, getMercadoLivreCredentials, saveMercadoLivreCredentials, disconnectMercadoLivre, pingMlConnection, startMlOAuth, listMlAccounts, setPrimaryMlAccount, deleteMlAccount, getMlAppConfigStatus, getGeminiCredentials, saveGeminiCredentials, type SyncProgress, type MlAccountSummary, type OrderSyncOptions } from '@/app/actions';
import { format, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
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
  
  const [syncMode, setSyncMode] = React.useState<'smart' | 'period'>('smart');
  const [importSummary, setImportSummary] = React.useState<any>(null);
  const [syncStatusMessage, setSyncStatusMessage] = React.useState<string>('');
  const [syncProgressData, setSyncProgressData] = React.useState<SyncProgress | null>(null);
  const [includeInvoiceDetails, setIncludeInvoiceDetails] = React.useState(true);
  const [fetchInvoiceXml, setFetchInvoiceXml] = React.useState(false);

  // Mercado Livre states
  const [mlCredentials, setMlCredentials] = React.useState({ appId: '', clientSecret: '' });
  const [mlStatus, setMlStatus] = React.useState<ApiStatus>('unchecked');
  const [mlCallbackUrl, setMlCallbackUrl] = React.useState('');
  const [mlAuthUrl, setMlAuthUrl] = React.useState('');
  const [isMlSaving, setIsMlSaving] = React.useState(false);
  const [isMlGenerating, setIsMlGenerating] = React.useState(false);
  const [mlUserId, setMlUserId] = React.useState<string | undefined>();
  const [mlAccounts, setMlAccounts] = React.useState<MlAccountSummary[]>([]);
  const [mlAccountActionId, setMlAccountActionId] = React.useState<string | null>(null);
  const [mlAppConfig, setMlAppConfig] = React.useState<{ configured: boolean; source: string; appIdMasked?: string } | null>(null);

  // Gemini IA states
  const [geminiCredentials, setGeminiCredentials] = React.useState({ apiKey: '' });
  const [geminiStatus, setGeminiStatus] = React.useState<ApiStatus>('unchecked');
  const [geminiSource, setGeminiSource] = React.useState<'firestore' | 'env' | 'none'>('none');
  const [isGeminiSaving, setIsGeminiSaving] = React.useState(false);

  const { toast } = useToast();
  
  const refreshMlAccounts = React.useCallback(async () => {
    try {
        const list = await listMlAccounts();
        setMlAccounts(list);
    } catch (e) {
        console.error('Erro ao listar contas ML:', e);
    }
  }, []);

  const loadInitialData = React.useCallback(async () => {
    setIsLoading(true);
    try {
        const [savedCreds, count, mlCreds, accounts, appCfg, geminiCreds] = await Promise.all([
            getBlingCredentials(),
            countImportedOrders(),
            getMercadoLivreCredentials(),
            listMlAccounts(),
            getMlAppConfigStatus(),
            getGeminiCredentials(),
        ]);
        setMlAccounts(accounts);
        setMlAppConfig(appCfg);
        setCredentials(prev => ({ ...prev, clientId: savedCreds.clientId || '', clientSecret: savedCreds.clientSecret || '' }));
        setImportedCount(count);
        setApiStatus(savedCreds.connected ? 'valid' : 'unchecked');

        // Mercado Livre — exibe o estado armazenado primeiro
        setMlCredentials(prev => ({ ...prev, appId: mlCreds.appId || '', clientSecret: mlCreds.clientSecret || '' }));
        setMlStatus(mlCreds.connected ? 'valid' : 'unchecked');
        setMlUserId(mlCreds.userId);
        setGeminiCredentials({ apiKey: geminiCreds.apiKey || '' });
        setGeminiStatus(geminiCreds.configured ? 'valid' : 'unchecked');
        setGeminiSource(geminiCreds.source);

        // ...e revalida em background contra a API do ML (refresh + /users/me).
        // Não faz await — não bloqueia o load principal.
        if (mlCreds.connected) {
            pingMlConnection(mlCreds.accountId)
                .then((ping) => {
                    setMlStatus(ping.status);
                    if (ping.userId !== undefined) {
                        setMlUserId(String(ping.userId));
                    }
                    if (ping.status === 'invalid') {
                        console.warn('[ML PING] Conexão inválida:', ping.error);
                    }
                })
                .catch((err) => {
                    console.error('[ML PING] Erro inesperado:', err);
                    setMlStatus('invalid');
                });
        }

    } catch (error) {
        console.error("Failed to load credentials:", error);
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
        setMlCallbackUrl(`${window.location.origin}/api/callback/mercadolivre`);
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

    // Bling usa a URL de callback cadastrada no aplicativo automaticamente
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
          const syncOptions: OrderSyncOptions = {
              includeInvoiceDetails,
              fetchInvoiceXml: includeInvoiceDetails && fetchInvoiceXml,
          };
          const result = await syncFunction(date?.from, date?.to, syncOptions);

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
                  description: `${result.summary.created} novos, ${result.summary.updated} atualizados. NFs: ${result.summary.invoiceDetailsFetched || 0}. Total: ${totalCount}`,
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

  // Mercado Livre handlers
  const handleMlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    const field = id.replace('ml-', '');
    setMlCredentials(prev => ({ ...prev, [field]: value }));
  };

  const handleGeminiInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGeminiCredentials({ apiKey: e.target.value });
  };

  const handleGeminiSaveCredentials = async () => {
    const apiKey = geminiCredentials.apiKey.trim();
    if (!apiKey || apiKey === '********') {
      toast({
        variant: 'destructive',
        title: 'Chave Gemini faltando',
        description: 'Informe uma nova chave Gemini antes de salvar.',
      });
      return;
    }

    setIsGeminiSaving(true);
    try {
      await saveGeminiCredentials({ apiKey });
      toast({
        title: 'Chave Gemini salva',
        description: 'O Atendimento passará a usar esta chave para gerar respostas com IA.',
      });
      await loadInitialData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar Gemini',
        description: error?.message || 'Não foi possível salvar a chave.',
      });
    } finally {
      setIsGeminiSaving(false);
    }
  };

  const handleMlSaveCredentials = async () => {
    setIsMlSaving(true);
    try {
        // Importante: se o usuário não redigitou o secret (campo mascarado como
        // "********"), NÃO enviar — evita sobrescrever o secret real no banco.
        const payload: { appId: string; clientSecret?: string } = {
            appId: mlCredentials.appId,
        };
        if (mlCredentials.clientSecret && mlCredentials.clientSecret !== '********') {
            payload.clientSecret = mlCredentials.clientSecret;
        }

        await saveMercadoLivreCredentials(payload);
        toast({
            title: "Credenciais Salvas!",
            description: "Suas credenciais do Mercado Livre foram salvas com sucesso.",
        });
        await loadInitialData();
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Erro ao Salvar",
            description: "Não foi possível salvar as credenciais.",
        });
    } finally {
        setIsMlSaving(false);
    }
  };

  const handleMlConnect = async () => {
    setIsMlGenerating(true);
    try {
        // Server action resolve App ID/Secret server-side (env > Firestore),
        // gera state CSRF + PKCE S256 e devolve a URL.
        const { authorizationUrl } = await startMlOAuth({
            requestOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        });
        // Redireciona o navegador direto para a tela de autorização do ML.
        if (typeof window !== 'undefined') {
            window.location.href = authorizationUrl;
        }
    } catch (e: any) {
        setIsMlGenerating(false);
        toast({
            variant: 'destructive',
            title: 'Erro ao iniciar conexão',
            description: e?.message || 'Não foi possível iniciar o fluxo OAuth do Mercado Livre.',
        });
    }
    // Não setamos isMlGenerating(false) no caso de sucesso porque a página
    // está sendo navegada para fora.
  };

  const handleMlDisconnect = async () => {
    setIsMlSaving(true);
    try {
        await disconnectMercadoLivre();
        setMlAuthUrl('');
        await loadInitialData();
        toast({ title: 'Desconectado!', description: 'A integração com o Mercado Livre foi removida.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro ao Desconectar', description: String(error?.message || error) });
    } finally {
        setIsMlSaving(false);
    }
  };

  const handleAccountDisconnect = async (accountId: string) => {
    setMlAccountActionId(accountId);
    try {
        await disconnectMercadoLivre(accountId);
        await refreshMlAccounts();
        toast({ title: 'Conta desconectada', description: 'Tokens removidos. Você pode reconectar quando quiser.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro', description: String(error?.message || error) });
    } finally {
        setMlAccountActionId(null);
    }
  };

  const handleSetPrimary = async (accountId: string) => {
    setMlAccountActionId(accountId);
    try {
        await setPrimaryMlAccount(accountId);
        await refreshMlAccounts();
        toast({ title: 'Conta primária atualizada' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro', description: String(error?.message || error) });
    } finally {
        setMlAccountActionId(null);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    setMlAccountActionId(accountId);
    try {
        await deleteMlAccount(accountId);
        await refreshMlAccounts();
        toast({ title: 'Conta removida', description: 'Conta excluída de mercadoLivreAccounts.' });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro ao excluir conta', description: String(error?.message || error) });
    } finally {
        setMlAccountActionId(null);
    }
  };

  const handlePingAccount = async (accountId: string) => {
    setMlAccountActionId(accountId);
    try {
        const ping = await pingMlConnection(accountId);
        if (ping.status === 'valid') {
            toast({ title: 'Conexão OK', description: ping.nickname ? `Olá, ${ping.nickname}` : 'Token renovado com sucesso.' });
        } else {
            toast({ variant: 'destructive', title: 'Conexão inválida', description: ping.error || 'Falha ao validar token.' });
        }
        await refreshMlAccounts();
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro', description: String(error?.message || error) });
    } finally {
        setMlAccountActionId(null);
    }
  };

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

              <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                          <Label htmlFor="include-invoice-details" className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              Dados da NF-e
                          </Label>
                          <p className="text-xs text-muted-foreground">
                              Consulta a nota fiscal vinculada ao pedido e salva chave de acesso, numero, serie, emissao, situacao e valor.
                          </p>
                      </div>
                      <Switch
                          id="include-invoice-details"
                          checked={includeInvoiceDetails}
                          disabled={isImporting}
                          onCheckedChange={(checked) => {
                              setIncludeInvoiceDetails(checked);
                              if (!checked) setFetchInvoiceXml(false);
                          }}
                      />
                  </div>
                  <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                          <Label htmlFor="fetch-invoice-xml">Baixar XML da NF-e</Label>
                          <p className="text-xs text-muted-foreground">
                              Salva o XML em fiscalDocuments para futuras analises fiscais. Pode deixar a sincronizacao mais lenta.
                          </p>
                      </div>
                      <Switch
                          id="fetch-invoice-xml"
                          checked={fetchInvoiceXml}
                          disabled={isImporting || !includeInvoiceDetails}
                          onCheckedChange={setFetchInvoiceXml}
                      />
                  </div>
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
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
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
                          <div className="bg-slate-50 p-2 rounded text-center">
                              <div className="font-bold text-slate-600">{importSummary.invoiceDetailsFetched || 0}</div>
                              <div className="text-slate-500">NFs Consultadas</div>
                          </div>
                          <div className="bg-indigo-50 p-2 rounded text-center">
                              <div className="font-bold text-indigo-600">{importSummary.invoiceXmlFetched || 0}</div>
                              <div className="text-indigo-500">XMLs Baixados</div>
                          </div>
                      </div>
                  )}
              </div>
            </div>
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

        {/* Mercado Livre Card */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
                <div>
                    <CardTitle>Mercado Livre API</CardTitle>
                    <CardDescription>
                      Conecte uma ou mais contas do Mercado Livre para sincronizar dados das suas lojas.
                    </CardDescription>
                </div>
                <div className="flex items-center gap-4">
                    {mlAccounts.length > 0 && (
                         <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground bg-muted p-2 rounded-md">
                            {mlAccounts.length} {mlAccounts.length === 1 ? 'conta' : 'contas'}
                        </div>
                    )}
                    <ApiStatusBadge status={mlStatus} />
                </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="m-auto h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Lista de contas conectadas */}
                {mlAccounts.length > 0 && (
                  <div className="space-y-2">
                    <Label>Contas conectadas</Label>
                    <div className="space-y-2">
                      {mlAccounts.map((acc) => {
                        const status: ApiStatus = acc.apiStatus || (acc.hasRefreshToken ? 'valid' : 'unchecked');
                        const isBusy = mlAccountActionId === acc.accountId;
                        return (
                          <div key={acc.accountId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <ApiStatusBadge status={status} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold truncate">
                                    {acc.nickname || acc.accountName || acc.accountId}
                                  </p>
                                  {acc.isPrimary && (
                                    <Badge variant="default" className="bg-blue-600 hover:bg-blue-700">Primária</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {acc.userId ? `User ID: ${acc.userId}` : `ID: ${acc.accountId}`}
                                  {acc.appId ? ` · App ${acc.appId}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => handlePingAccount(acc.accountId)}
                              >
                                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Testar'}
                              </Button>
                              {!acc.isPrimary && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy}
                                  onClick={() => handleSetPrimary(acc.accountId)}
                                >
                                  Tornar primária
                                </Button>
                              )}
                              {acc.hasRefreshToken && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy}
                                  onClick={() => handleAccountDisconnect(acc.accountId)}
                                >
                                  Desconectar
                                </Button>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" className="text-destructive" disabled={isBusy}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir conta?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Isso remove a conta de <code>mercadoLivreAccounts</code>. Para reconectar, será necessário refazer o OAuth.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteAccount(acc.accountId)}>
                                      Excluir
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <Separator />

                {/* Conexão simplificada — botão único redireciona para o ML */}
                <div className="flex flex-col items-start gap-3 max-w-lg">
                  <div>
                    <Label className="text-base">
                      {mlAccounts.length === 0 ? 'Conectar conta Mercado Livre' : 'Adicionar outra conta'}
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Você será redirecionado para o Mercado Livre para autorizar o acesso. Após autorizar, voltará automaticamente para esta página.
                    </p>
                  </div>

                  {mlAppConfig && !mlAppConfig.configured ? (
                    <div className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <p className="font-semibold text-destructive">App não configurado</p>
                      <p className="text-muted-foreground mt-1">
                        Defina <code>MERCADOLIVRE_APP_ID</code> e <code>MERCADOLIVRE_CLIENT_SECRET</code> nas variáveis de ambiente do Vercel para habilitar a conexão.
                      </p>
                    </div>
                  ) : (
                    <Button
                      size="lg"
                      onClick={handleMlConnect}
                      disabled={isMlGenerating}
                      className="bg-[#FFE600] text-black hover:bg-[#FFE600]/90"
                    >
                      {isMlGenerating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Redirecionando para o Mercado Livre...
                        </>
                      ) : (
                        <>
                          <Plug className="mr-2 h-4 w-4" />
                          {mlAccounts.length === 0 ? 'Conectar com Mercado Livre' : 'Conectar outra conta'}
                        </>
                      )}
                    </Button>
                  )}

                  {mlAppConfig?.configured && mlAppConfig.appIdMasked && (
                    <p className="text-xs text-muted-foreground">
                      App configurado: <code>{mlAppConfig.appIdMasked}</code> (origem: {
                        mlAppConfig.source === 'env' ? 'env vars' :
                        mlAppConfig.source === 'legacy-firestore' ? 'Firestore (legado)' :
                        'Firestore (conta existente)'
                      })
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gemini IA Card */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start gap-4">
              <div>
                <CardTitle>Gemini IA</CardTitle>
                <CardDescription>
                  Chave usada pelo Atendimento para gerar respostas sugeridas.
                </CardDescription>
              </div>
              <ApiStatusBadge status={geminiStatus} />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="m-auto h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="flex max-w-lg flex-col items-start gap-4">
                <div className="w-full space-y-2">
                  <Label htmlFor="gemini-api-key">API Key</Label>
                  <Input
                    id="gemini-api-key"
                    type="password"
                    placeholder={geminiCredentials.apiKey === '********' ? '********' : 'Cole sua chave Gemini aqui'}
                    value={geminiCredentials.apiKey}
                    onChange={handleGeminiInputChange}
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleGeminiSaveCredentials} disabled={isGeminiSaving}>
                    {isGeminiSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <KeyRound className="mr-2 h-4 w-4" />
                        Salvar Chave Gemini
                      </>
                    )}
                  </Button>
                  {geminiSource !== 'none' && (
                    <Badge variant="outline">
                      Origem: {geminiSource === 'firestore' ? 'Conexão API' : 'variável de ambiente'}
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  A chave fica armazenada no servidor e aparece mascarada depois de salva.
                </p>
              </div>
            )}
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
            Gerencie as configurações de conexão com suas APIs.
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
