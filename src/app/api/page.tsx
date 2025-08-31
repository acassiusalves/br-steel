"use client";

import * as React from 'react';
import { KeyRound, Loader2, Copy } from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function ApiPage() {
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [callbackUrl, setCallbackUrl] = React.useState('');
  const [authUrl, setAuthUrl] = React.useState('');
  const { toast } = useToast();


  React.useEffect(() => {
    // This code runs only on the client, after the component has mounted.
    setCallbackUrl(`${window.location.origin}/api/callback/bling`);
  }, []);


  const handleConnect = () => {
    setIsLoading(true);
    // Gerar um 'state' aleatório para segurança
    const state = Math.random().toString(36).substring(7);
    // Armazenar o state em localStorage para verificar no callback
    localStorage.setItem('bling_oauth_state', state);

    const authorizationUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${clientId}&state=${state}`;
    
    setAuthUrl(authorizationUrl);
    setIsLoading(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(authUrl);
    toast({
      title: "URL Copiada!",
      description: "O link de autorização foi copiado para sua área de transferência.",
    });
  }

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-12 p-4 pt-6 md:p-8">
        <section id="api">
           <Card>
              <CardHeader>
                <CardTitle>Integração com Bling</CardTitle>
                <CardDescription>
                  Conecte sua conta do Bling para sincronizar suas vendas. Preencha suas credenciais de aplicativo obtidas no Bling.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-start gap-6 max-w-lg">
                  <div className="w-full space-y-2">
                    <Label htmlFor="bling-client-id">Client ID</Label>
                    <Input 
                      id="bling-client-id" 
                      type="text"
                      placeholder="Cole seu Client ID aqui" 
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </div>
                   <div className="w-full space-y-2">
                    <Label htmlFor="bling-client-secret">Client Secret</Label>
                    <Input 
                      id="bling-client-secret" 
                      type="password"
                      placeholder="Cole seu Client Secret aqui" 
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleConnect} disabled={isLoading || !clientId || !clientSecret}>
                    {isLoading ? (
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

                  {authUrl && (
                     <div className="w-full space-y-2">
                      <Label htmlFor="auth-url">Link de Autorização</Label>
                       <div className="flex items-center gap-2">
                          <Input 
                            id="auth-url" 
                            type="text"
                            readOnly
                            value={authUrl}
                            className="bg-muted"
                          />
                          <Button variant="outline" size="icon" onClick={handleCopy}>
                            <Copy className="h-4 w-4" />
                          </Button>
                       </div>
                       <p className="text-sm text-muted-foreground">
                        Copie o link acima e cole em um navegador onde você está logado no Bling para autorizar o acesso.
                      </p>
                    </div>
                  )}

                   <p className="text-sm text-muted-foreground">
                    Certifique-se de que a URL de callback no seu app do Bling está configurada para: <code className="bg-muted px-1 py-0.5 rounded-sm">{callbackUrl || 'Carregando...'}</code>
                  </p>
                </div>
              </CardContent>
            </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
