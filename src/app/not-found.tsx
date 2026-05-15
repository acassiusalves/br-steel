import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/40 px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Página não encontrada</h1>
        <p className="text-muted-foreground">
          O endereço acessado não existe ou foi movido.
        </p>
      </div>
      <Button asChild>
        <Link href="/vendas?tab=dashboard">Voltar ao painel</Link>
      </Button>
    </main>
  );
}
