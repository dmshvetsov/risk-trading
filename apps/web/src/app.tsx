import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router";
import { SuiProviders } from "./components/sui-providers";

export function App() {
  return (
    <SuiProviders>
      <RouterProvider router={router} />
    </SuiProviders>
  );
}
