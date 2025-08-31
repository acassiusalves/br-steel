import DashboardLayout from '@/components/dashboard-layout';
import PredictiveAnalysis from '@/components/predictive-analysis';
import SalesDashboard from '@/components/sales-dashboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function Home() {
  return (
    <DashboardLayout>
      <div className="flex-1 space-y-12 p-4 pt-6 md:p-8">
        <section id="painel">
          <SalesDashboard />
        </section>
        <section id="analise">
          <PredictiveAnalysis />
        </section>
        <section id="relatorios">
           <Card>
              <CardHeader>
                <CardTitle>Relatórios de Vendas</CardTitle>
                <CardDescription>
                  Gere relatórios detalhados sobre o desempenho das suas vendas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-start gap-4">
                  <p className="text-muted-foreground">
                    Em breve, você poderá gerar relatórios diários, semanais e mensais com um clique.
                  </p>
                  <Button disabled>Gerar Relatório</Button>
                </div>
              </CardContent>
            </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
