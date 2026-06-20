import type { PropsWithChildren } from "react";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

import { appConfig } from "../lib/config";

export function SuiProviders({ children }: PropsWithChildren) {
  return (
    <SuiClientProvider networks={appConfig.networkConfig}>
      <WalletProvider autoConnect>{children}</WalletProvider>
    </SuiClientProvider>
  );
}
