import { describe, expect, it } from "vitest";

import { targetPriceLabel } from "./marketLabels";

describe("marketLabels", () => {
  it("uses listing-price wording for Vancouver", () => {
    expect(
      targetPriceLabel({
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 700,
        bedrooms: 1,
        bathrooms: 1,
      }),
    ).toBe("Target listing price");
  });

  it("uses sale-price wording for Halifax", () => {
    expect(
      targetPriceLabel({
        postalCode: "B3H 1A1",
        propertyType: "Detached",
        livingAreaSqft: 1800,
        bedrooms: 3,
        bathrooms: 2,
      }),
    ).toBe("Target sale price");
  });
});
