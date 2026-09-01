import { describe, expect, it } from "vitest";
import { SAAS_CHURN_PINNED, generateSaasChurnRows } from "./saas-churn";
import { generateHealthcarePiiRows } from "./healthcare-pii";

const saasRows = generateSaasChurnRows();
const healthRows = generateHealthcarePiiRows();

/** JS-side re-derivation of the three pinned aggregates, in exact integers. */
function saasAggregate(rows: ReturnType<typeof generateSaasChurnRows>) {
  let churned = 0;
  let tickets = 0;
  let churnedMrrCents = 0;
  for (const row of rows) {
    if (row.churned) {
      churned += 1;
      churnedMrrCents += Math.round(row.mrr * 100);
    }
    tickets += row.tickets;
  }
  return { churned, tickets, churnedMrrCents };
}

describe("saas_churn seed", () => {
  it("is deterministic across calls", () => {
    const again = generateSaasChurnRows();
    expect(again.length).toBe(saasRows.length);
    for (const index of [0, 1, 7, 999, 125_000, 249_999]) {
      expect(again[index]).toEqual(saasRows[index]);
    }
  });

  it("constructs the pinned prd.md §6.1 aggregates exactly", () => {
    const { churned, tickets, churnedMrrCents } = saasAggregate(saasRows);
    expect(churned).toBe(35_500);
    expect(tickets).toBe(1_200_000);
    expect(churnedMrrCents).toBe(18_240_000);
    expect((100 * churned) / saasRows.length).toBe(SAAS_CHURN_PINNED.churnRatePct);
    expect(tickets / saasRows.length).toBe(SAAS_CHURN_PINNED.avgTickets);
    expect(churnedMrrCents / 100).toBe(SAAS_CHURN_PINNED.impactedMrr);
  });

  it("produces 250,000 rows with the fourteen catalog columns", () => {
    expect(saasRows.length).toBe(250_000);
    expect(Object.keys(saasRows[0] as object).length).toBe(14);
  });

  it("shows the churn-vs-tickets profile rising above 5 tickets", () => {
    const rateAt = (ticketCount: number) => {
      let accounts = 0;
      let churned = 0;
      for (const row of saasRows) {
        if (row.tickets === ticketCount) {
          accounts += 1;
          if (row.churned) churned += 1;
        }
      }
      return churned / accounts;
    };
    // The prd.md §6.1 scatter property: churn visibly increases when tickets > 5.
    expect(rateAt(9)).toBeGreaterThan(rateAt(5));
    expect(rateAt(5)).toBeGreaterThan(rateAt(2));
    expect(rateAt(10)).toBeGreaterThan(0.2);
  });

  it("keeps every field inside its catalog type", () => {
    for (const row of [saasRows[0], saasRows[123_456], saasRows[249_999]]) {
      expect(row?.mrr).toBeGreaterThanOrEqual(2);
      expect(row?.mrr).toBeLessThanOrEqual(8);
      expect(row?.churn_rate).toBeLessThanOrEqual(1);
      expect(row?.feature_adoption_score).toBeLessThanOrEqual(1);
      expect(row?.nps_score).toBeLessThanOrEqual(10);
      expect(row?.tenant_id).toMatch(/^t_\d{6}$/);
    }
  });
});

describe("healthcare_pii seed", () => {
  it("is deterministic across calls", () => {
    const again = generateHealthcarePiiRows();
    expect(again.length).toBe(healthRows.length);
    for (const index of [0, 1, 7, 50_000, 99_999]) {
      expect(again[index]).toEqual(healthRows[index]);
    }
  });

  it("produces 100,000 rows and never materializes mrn", () => {
    expect(healthRows.length).toBe(100_000);
    for (const index of [0, 1, 50_000, 99_999]) {
      expect("mrn" in (healthRows[index] as object)).toBe(false);
    }
  });

  it("keeps every diagnosis cohort above the ten-record floor", () => {
    const cohorts = new Map<string, number>();
    for (const row of healthRows) {
      cohorts.set(row.diagnosis, (cohorts.get(row.diagnosis) ?? 0) + 1);
    }
    expect(cohorts.size).toBe(8);
    for (const patients of cohorts.values()) {
      expect(patients).toBeGreaterThanOrEqual(10);
    }
  });

  it("keeps billed amounts inside the DECIMAL(10,2) draw range", () => {
    for (const index of [0, 1, 50_000, 99_999]) {
      const row = healthRows[index];
      expect(row?.billed_amount).toBeGreaterThanOrEqual(40);
      expect(row?.billed_amount).toBeLessThanOrEqual(3000);
    }
  });
});
