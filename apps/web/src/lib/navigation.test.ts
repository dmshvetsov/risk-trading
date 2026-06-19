import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { navigationItems } from "./navigation";
import { getWalletLabel } from "./wallet";

describe("navigationItems", () => {
  it("keeps unique paths for each top-level route", () => {
    const paths = navigationItems.map((item) => item.href);

    assert.equal(new Set(paths).size, paths.length);
  });

  it("keeps the maker dashboard hidden from visible navigation", () => {
    assert.equal(
      navigationItems.some((item) => item.href === "/maker"),
      false,
    );
  });
});

describe("getWalletLabel", () => {
  it("shows a plain disconnected state", () => {
    assert.equal(getWalletLabel(null), "Wallet not connected");
  });

  it("shortens connected addresses for the shell header", () => {
    assert.equal(
      getWalletLabel("0x1234567890abcdef1234567890abcdef12345678"),
      "Wallet 0x1234...5678",
    );
  });
});
