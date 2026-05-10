"use client";

import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/query-client";

// ---------------------------------------------------------------------------
// QueryProvider — root mount point for the global QueryClient.
//
// Mounted ONCE at the root layout. The client itself is a
// module-level singleton in lib/query-client.ts so non-React code
// (interceptors, the offline-sync engine) can invalidate caches
// without going through React.
//
// Devtools:
//   • Mounted only in NODE_ENV !== 'production'. The package
//     ships under devDependencies-style usage (zero bundle cost
//     in prod via tree-shaking when ENV is `production`).
//   • Press `Ctrl+H` (or click the floating logo) to open. Shows:
//       — every active query key
//       — fetch counts
//       — observers (which components are subscribed)
//       — stale / fresh state
//       — last fetch time
//     This is the "dev fetch debugger" panel from Step 10.
// ---------------------------------------------------------------------------

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(() => getQueryClient(), []);
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV !== "production" && (
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="bottom-right"
        />
      )}
    </QueryClientProvider>
  );
}
