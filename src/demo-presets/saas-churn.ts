import { intBetween, mulberry32, pickWeighted } from "./prng";

/**
 * The `saas_churn` deterministic row generator — the seed half of the
 * seed→relation triple (ARCHITECTURE.md; prd.md §6.1). One fixed seed, one
 * fixed draw order, so every call materializes byte-identical data.
 *
 * The prd.md §6.1 headline values are exact by construction, not tuned
 * chrome constants: exactly 35,500 churned of 250,000 (14.2%), exactly
 * 1,200,000 tickets (avg 4.8), and exactly $182,400 of churned MRR. The
 * per-ticket churn profile rises steeply above 5 tickets, which is what the
 * canonical scatter shows. `_contract/preset-numbers.test.ts` runs the
 * canonical SQL in real DuckDB and fails if any pinned value drifts.
 */

export const SAAS_CHURN_ROW_COUNT = 250_000;
export const SAAS_CHURN_SEED = 0x1a4c42;

/** prd.md §6.1 headline values the canonical SQL must reproduce exactly. */
export const SAAS_CHURN_PINNED = {
  churnRatePct: 14.2,
  avgTickets: 4.8,
  impactedMrr: 182_400,
} as const;

const CHURNED_COUNT = 35_500; // 14.2% of 250,000
const TOTAL_TICKETS = 1_200_000; // avg 4.8 across all rows
const CHURNED_MRR_CENTS = 18_240_000; // $182,400 across churned rows
const TICKET_CEILING = 20; // correction-pass headroom above any drawn value

/** Per-mille ticket weights, tickets 0..10 (mean ≈ 4.4). */
const NON_CHURNED_TICKET_WEIGHTS = [88, 98, 110, 114, 117, 112, 102, 95, 85, 51, 28];
/** Per-mille ticket weights, tickets 2..14 (mean ≈ 8): churn concentrates high. */
const CHURNED_TICKET_WEIGHTS = [15, 30, 55, 80, 105, 125, 140, 145, 130, 90, 50, 22, 13];

/**
 * Plans on one uniform 200-cent lattice: the churned-MRR correction moves
 * rows one plan level per ±200-cent step, so the exact $182,400 total is
 * always reachable regardless of the drawn starting mix.
 */
const PLAN_NAMES = ["starter", "team", "business", "scale"] as const;
const PLAN_CENTS = [200, 400, 600, 800];
const PLAN_WEIGHTS = [30, 35, 25, 10];
const PLAN_SEAT_RANGES = [
  [1, 3],
  [2, 8],
  [5, 20],
  [10, 40],
] as const;

const INDUSTRIES = ["retail", "saas", "finance", "health", "education", "media"] as const;
const REGIONS = ["na", "emea", "apac", "latam"] as const;
const SIGNUP_CHANNELS = ["organic", "paid", "referral", "partner"] as const;

/** One `saas_churn` row; field order mirrors the catalog column order. */
export interface SaasChurnRow {
  tenant_id: string;
  plan: string;
  seats: number;
  mrr: number;
  tickets: number;
  churned: boolean;
  churn_rate: number;
  tenure_months: number;
  last_login_days: number;
  feature_adoption_score: number;
  nps_score: number;
  industry: string;
  region: string;
  signup_channel: string;
}

export function generateSaasChurnRows(): SaasChurnRow[] {
  const rand = mulberry32(SAAS_CHURN_SEED);

  // Exact churn set: partial Fisher-Yates marks exactly CHURNED_COUNT rows.
  const indices = new Uint32Array(SAAS_CHURN_ROW_COUNT);
  for (let i = 0; i < SAAS_CHURN_ROW_COUNT; i++) indices[i] = i;
  for (let i = 0; i < CHURNED_COUNT; i++) {
    const j = i + Math.floor(rand() * (SAAS_CHURN_ROW_COUNT - i));
    const swapped = indices[j] as number;
    indices[j] = indices[i] as number;
    indices[i] = swapped;
  }
  const churned = new Uint8Array(SAAS_CHURN_ROW_COUNT);
  for (let i = 0; i < CHURNED_COUNT; i++) churned[indices[i] as number] = 1;

  // Tickets: churned rows draw from the high-ticket mix, then one correction
  // pass nudges single tickets until the pinned total is exact.
  const tickets = new Uint8Array(SAAS_CHURN_ROW_COUNT);
  let ticketSum = 0;
  for (let i = 0; i < SAAS_CHURN_ROW_COUNT; i++) {
    const weights = churned[i] ? CHURNED_TICKET_WEIGHTS : NON_CHURNED_TICKET_WEIGHTS;
    const value = pickWeighted(rand, weights) + (churned[i] ? 2 : 0);
    tickets[i] = value;
    ticketSum += value;
  }
  closeIntegerTotal(tickets, ticketSum, TOTAL_TICKETS, TICKET_CEILING);

  // Observed churn rate per ticket bucket, from the final ticket assignment.
  const bucketAccounts = new Uint32Array(TICKET_CEILING + 1);
  const bucketChurned = new Uint32Array(TICKET_CEILING + 1);
  for (let i = 0; i < SAAS_CHURN_ROW_COUNT; i++) {
    const ticketCount = tickets[i] as number;
    bucketAccounts[ticketCount] = (bucketAccounts[ticketCount] as number) + 1;
    if (churned[i]) bucketChurned[ticketCount] = (bucketChurned[ticketCount] as number) + 1;
  }
  const bucketChurnRate = new Float64Array(TICKET_CEILING + 1);
  for (let t = 0; t <= TICKET_CEILING; t++) {
    bucketChurnRate[t] = bucketAccounts[t] ? (bucketChurned[t] as number) / (bucketAccounts[t] as number) : 0;
  }

  // Churned plans: draw, then step ±200 cents (one plan level) until the
  // churned MRR total is exactly CHURNED_MRR_CENTS.
  const churnedPlan = new Uint8Array(SAAS_CHURN_ROW_COUNT);
  let churnedMrrCents = 0;
  for (let i = 0; i < SAAS_CHURN_ROW_COUNT; i++) {
    if (!churned[i]) continue;
    const plan = pickWeighted(rand, PLAN_WEIGHTS);
    churnedPlan[i] = plan;
    churnedMrrCents += PLAN_CENTS[plan] as number;
  }
  closeChurnedMrr(churned, churnedPlan, churnedMrrCents);

  const rows: SaasChurnRow[] = Array.from({ length: SAAS_CHURN_ROW_COUNT }, (_, i) => {
    const isChurned = churned[i] === 1;
    const plan = isChurned ? (churnedPlan[i] as number) : pickWeighted(rand, PLAN_WEIGHTS);
    const [seatLo, seatHi] = PLAN_SEAT_RANGES[plan] as readonly [number, number];
    return {
      tenant_id: `t_${String(i + 1).padStart(6, "0")}`,
      plan: PLAN_NAMES[plan] as string,
      seats: intBetween(rand, seatLo, seatHi),
      mrr: (PLAN_CENTS[plan] as number) / 100,
      tickets: tickets[i] as number,
      churned: isChurned,
      churn_rate: Math.round((bucketChurnRate[tickets[i] as number] as number) * 10000) / 10000,
      tenure_months: isChurned ? intBetween(rand, 1, 24) : intBetween(rand, 1, 60),
      last_login_days: isChurned ? intBetween(rand, 7, 90) : intBetween(rand, 0, 14),
      feature_adoption_score:
        Math.round((isChurned ? rand() * 0.45 : 0.1 + rand() * 0.85) * 1000) / 1000,
      nps_score: isChurned ? intBetween(rand, 0, 6) : intBetween(rand, 3, 10),
      industry: INDUSTRIES[Math.floor(rand() * INDUSTRIES.length)] as string,
      region: REGIONS[Math.floor(rand() * REGIONS.length)] as string,
      signup_channel: SIGNUP_CHANNELS[Math.floor(rand() * SIGNUP_CHANNELS.length)] as string,
    };
  });
  return rows;
}

/** Nudge ±1 ticket in row order until the array sums to exactly `target`. */
function closeIntegerTotal(values: Uint8Array, current: number, target: number, ceiling: number): void {
  let delta = target - current;
  let i = 0;
  const guard = 4 * values.length;
  let steps = guard;
  while (delta > 0 && steps-- > 0) {
    if ((values[i] as number) < ceiling) {
      values[i] = (values[i] as number) + 1;
      delta -= 1;
    }
    i = (i + 1) % values.length;
  }
  while (delta < 0 && steps > 0) {
    if ((values[i] as number) > 0) {
      values[i] = (values[i] as number) - 1;
      delta += 1;
    }
    i = (i + 1) % values.length;
    steps--;
  }
  if (delta !== 0) throw new Error("ticket correction pass failed to converge");
}

/** Step churned plans up/down one level (±200 cents) until the total is exact. */
function closeChurnedMrr(churned: Uint8Array, churnedPlan: Uint8Array, current: number): void {
  let delta = CHURNED_MRR_CENTS - current;
  if (delta % 200 !== 0) throw new Error("churned MRR delta off the 200-cent plan lattice");
  let i = 0;
  let steps = 8 * CHURNED_COUNT;
  while (delta !== 0 && steps-- > 0) {
    if (!churned[i]) {
      i = (i + 1) % churnedPlan.length;
      continue;
    }
    const plan = churnedPlan[i] as number;
    if (delta > 0 && plan < PLAN_CENTS.length - 1) {
      churnedPlan[i] = plan + 1;
      delta -= 200;
    } else if (delta < 0 && plan > 0) {
      churnedPlan[i] = plan - 1;
      delta += 200;
    }
    i = (i + 1) % churnedPlan.length;
  }
  if (delta !== 0) throw new Error("churned MRR correction pass failed to converge");
}
