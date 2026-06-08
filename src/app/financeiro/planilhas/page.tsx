import { Suspense } from "react";

import PlanilhasClient from "./PlanilhasClient";

export const dynamic = "force-dynamic";

export default function PlanilhasPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Carregando planilhas...</div>}>
      <PlanilhasClient />
    </Suspense>
  );
}
