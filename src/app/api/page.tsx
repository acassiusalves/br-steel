
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function ApiRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/configuracoes?tab=api');
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Redirecionando para as configurações de API...</p>
        </div>
    </div>
  );
}
