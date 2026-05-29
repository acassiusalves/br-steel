import { Suspense } from "react";

import ProdutosClient from "./ProdutosClient";

export const dynamic = "force-dynamic";

export default function ProdutosPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando produtos...</div>}>
      <ProdutosClient />
    </Suspense>
  );
}
