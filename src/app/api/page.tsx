"use client";

import * as React from 'react';
import { KeyRound, Loader2, Copy, Save, CheckCircle, XCircle } from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getBlingCredentials, saveBlingCredentials } from '@/app/actions';

export default function ApiPage() {
  const [credentials, setCredentials] = React.useState({ clientId: '', clientSecret: '', accessToken: '' });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [callbackUrl, setCallbackUrl] = React.useState('');
  const [authUrl, setAuthUrl] = React.useState('');
  const { toast } = useToast();

  const isConnected = !!credentials.accessToken;

  React.useEffect(() => {
    // This code runs only on the client, after the component has mounted.
    setCallbackUrl(`${window.location.origin}/api/callback/bling`);
    
    // Carregar credenciais do servidor
    const fetchCredentials = async () => {
        setIsLoading(true);
        try {
            const savedCreds = await getBlingCredentials();
            setCredentials(prev => ({...prev, ...savedCreds}));
        } catch (error) {
            console.error("Failed to load Bling credentials:", error);
            toast({
                variant: "destructive",
                title: "Erro ao Carregar",
                description: "Não foi possível carregar as informações de conexão.",
            });
        } finally {
            setIsLoading(false);
        }
    };
    fetchCredentials();

  }, []);

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
        // Refetch to hide the secret
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
    // Gerar um 'state' aleatório para segurança
    const state = Math.random().toString(36).substring(7);
    // Armazenar o state em localStorage para verificar no callback
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

  const renderContent = () => {
    if (isLoading) {
        return <Loader2 className="m-auto h-8 w-8 animate-spin" />;
    }

    if (isConnected) {
        return (
            <div className="flex flex-col items-start gap-4 text-center sm:text-left">
                <div className="flex items-center gap-3">
                    <CheckCircle className="h-10 w-10 text-green-500" />
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
                    <KeyRound className="mr-2 h-4 w-4" />
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
      <div className="flex-1 space-y-12 p-4 pt-6 md:p-8">
        <section id="api">
           <Card>
              <CardHeader>
                <CardTitle>Integração com Bling</CardTitle>
                <CardDescription>
                  Conecte sua conta do Bling para sincronizar suas vendas. Suas credenciais são salvas de forma segura no servidor.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {renderContent()}
              </CardContent>
            </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
