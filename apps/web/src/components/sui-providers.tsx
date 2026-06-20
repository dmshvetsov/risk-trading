import type { PropsWithChildren } from "react";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";

import { appConfig } from "../lib/config";

export function SuiProviders({ children }: PropsWithChildren) {
  return (
    <SuiClientProvider networks={appConfig.networkConfig}>
      <WalletProvider autoConnect>{children}</WalletProvider>
    </SuiClientProvider>
  );
}
