import DashboardLayout from '@/components/dashboard-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ApiPage() {
  return (
    <DashboardLayout>
      <div className="flex-1 space-y-12 p-4 pt-6 md:p-8">
        <section id="api">
           <Card>
              <CardHeader>
                <CardTitle>Integração de API</CardTitle>
                <CardDescription>
                  Gerencie suas chaves de API e integrações.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-start gap-4">
                  <p className="text-muted-foreground">
                    Em breve, você poderá gerar e gerenciar suas chaves de API para integrações personalizadas.
                  </p>
                  <Button disabled>Gerar Nova Chave</Button>
                </div>
              </CardContent>
            </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
