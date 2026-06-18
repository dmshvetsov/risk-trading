export function getWalletLabel(address: string | null) {
  if (!address) {
    return "Wallet not connected";
  }

  return `Wallet ${address.slice(0, 6)}...${address.slice(-4)}`;
}
