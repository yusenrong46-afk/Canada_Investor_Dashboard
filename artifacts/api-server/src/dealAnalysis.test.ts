import { describe, expect, it } from "vitest";

import { labelDeal, type DealRiskFlag } from "./dealAnalysis";

const noRisk: DealRiskFlag[] = [{ level: "info", label: "Rule-based", detail: "Planning note" }];
const dangerRisk: DealRiskFlag[] = [{ level: "danger", label: "No modeled upside", detail: "Asking price is too high" }];

describe("labelDeal", () => {
  it("marks a high-upside clean deal as a strong lead", () => {
    expect(labelDeal(0.1, 0.01, noRisk)).toBe("Strong lead");
  });

  it("keeps moderate upside in review instead of overselling it", () => {
    expect(labelDeal(0.045, -0.01, noRisk)).toBe("Worth review");
  });

  it("passes when the after-plan value is below asking price", () => {
    expect(labelDeal(-0.01, -0.08, dangerRisk)).toBe("Pass for now");
  });
});
