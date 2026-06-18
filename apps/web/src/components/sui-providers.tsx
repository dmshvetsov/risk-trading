import type { PropsWithChildren } from "react";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

import { appConfig } from "../lib/config";

const { networkConfig } = createNetworkConfig({
  testnet: {
    network: "testnet",
    url: getJsonRpcFullnodeUrl("testnet"),
  },
  mainnet: {
    network: "mainnet",
    url: getJsonRpcFullnodeUrl("mainnet"),
  },
});

export function SuiProviders({ children }: PropsWithChildren) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork={appConfig.network}>
      <WalletProvider autoConnect>{children}</WalletProvider>
    </SuiClientProvider>
  );
}
