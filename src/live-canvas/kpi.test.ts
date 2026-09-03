import { describe, expect, it } from "vitest";
import { formatKpiValue } from "./kpi";

/**
 * The pinned KPI formatter (grilling 52): display only, never a rounding
 * step — the raw number leaves the kernel unchanged and this table decides
 * how it paints. The suppression aggregates, the artifact cards, and the
 * Charts KPI tiles all share it, so a format regression here is a custody
 * regression everywhere.
 */

describe("formatKpiValue", () => {
  it("renders the four schema formats", () => {
    expect(formatKpiValue(0.142, "percent")).toBe("14.2%");
    expect(formatKpiValue(4.8, "decimal")).toBe("4.8");
    expect(formatKpiValue(182400, "currency_usd")).toBe("$182,400");
    expect(formatKpiValue(120, "integer")).toBe("120");
  });

  it("keeps large values groupable and decimals at one place", () => {
    expect(formatKpiValue(1234567, "integer")).toBe("1,234,567");
    expect(formatKpiValue(0.14555, "percent")).toBe("14.6%");
    expect(formatKpiValue(-3.14159, "decimal")).toBe("-3.1");
  });

  it("never invents a value for null", () => {
    expect(formatKpiValue(null, "percent")).toBe("—");
    expect(formatKpiValue(null, "integer")).toBe("—");
  });
});
