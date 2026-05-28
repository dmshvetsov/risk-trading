import { describe, expect, it } from "vitest";

import { formatWalletDeficitMessage } from "./oracles.$oracleId";

describe("formatWalletDeficitMessage", () => {
  it("describes the available wallet balance instead of the deficit", () => {
    expect(formatWalletDeficitMessage(1_250_000n)).toBe(
      "You have only 1.25 DUSDC in wallet",
    );
  });
});
