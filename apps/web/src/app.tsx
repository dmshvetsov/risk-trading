import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { getRouter } from "./router";
import { SuiProviders } from "./components/sui-providers";

export function App() {
  const [router] = useState(() => getRouter());
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiProviders>
        <RouterProvider router={router} />
      </SuiProviders>
    </QueryClientProvider>
  );
}
