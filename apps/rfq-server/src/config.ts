export type MakerSigningConfig = {
  MAKER_STUB_PRIVATE_KEY?: string;
};

export function loadMakerStubPrivateKey(config: MakerSigningConfig) {
  const privateKey = config.MAKER_STUB_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error("MAKER_STUB_PRIVATE_KEY is not configured");
  }

  return privateKey;
}
