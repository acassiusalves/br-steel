"use client";

import * as React from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ApiPage() {
  const [apiKey, setApiKey] = React.useState('');
  const [isValid, setIsValid] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const handleValidate = async () => {
    setIsLoading(true);
    setIsValid(null);

    // Simulação de chamada de validação
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Lógica de validação de exemplo
    if (apiKey.trim() !== '') {
      setIsValid(true);
    } else {
      setIsValid(false);
    }

    setIsLoading(false);
  };

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-12 p-4 pt-6 md:p-8">
        <section id="api">
           <Card>
              <CardHeader>
                <CardTitle>Integração com Bling</CardTitle>
                <CardDescription>
                  Conecte sua conta do Bling para sincronizar suas vendas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-start gap-6 max-w-lg">
                  <div className="w-full space-y-2">
                    <Label htmlFor="bling-api-key">Chave de API do Bling</Label>
                    <div className="flex items-center gap-2">
                      <Input 
                        id="bling-api-key" 
                        type="password"
                        placeholder="Cole sua chave de API aqui" 
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setIsValid(null);
                        }}
                      />
                       {isValid === true && <CheckCircle className="h-6 w-6 text-green-500" />}
                       {isValid === false && <XCircle className="h-6 w-6 text-red-500" />}
                    </div>
                     {isValid === true && <p className="text-sm text-green-600">Sua chave de API foi validada e salva com sucesso!</p>}
                     {isValid === false && <p className="text-sm text-red-600">A chave de API parece ser inválida. Verifique e tente novamente.</p>}
                  </div>
                  <Button onClick={handleValidate} disabled={isLoading || !apiKey}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      'Salvar e Validar Chave'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
