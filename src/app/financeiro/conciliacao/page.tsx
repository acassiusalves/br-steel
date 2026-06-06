import { Suspense } from "react";

import ConciliacaoClient from "./ConciliacaoClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Carregando conciliação...</div>}>
      <ConciliacaoClient />
    </Suspense>
  );
}
