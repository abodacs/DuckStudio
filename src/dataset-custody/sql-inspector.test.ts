import { describe, expect, it } from "vitest";
import { inspectSql, lexSql } from "./sql-inspector";
import { saasChurnPreset } from "../demo-presets/catalog";

/**
 * The §6 deny-list matrix (ticket 27): every rejection class is blocked
 * before the worker sees SQL, with the pinned inspection order (statement
 * count → head keyword → forbidden constructs → relation references →
 * binding interpolation) and the pinned codes (UNSAFE_SQL for deny-list
 * violations, VALIDATION_ERROR for malformed/interpolated bindings,
 * DATASET_UNAVAILABLE for out-of-set relations).
 */

const AUTHORIZED = [saasChurnPreset.datasetId];
const SCHEMA = saasChurnPreset.columns;
const NO_BINDINGS = {};

function inspect(sql: string, bindings: Record<string, string | number | boolean | null> = NO_BINDINGS) {
  return inspectSql({ sql, bindings, authorizedRelations: AUTHORIZED, schema: SCHEMA });
}

const unsafeConstruct = (result: ReturnType<typeof inspect>) => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.failure.code).toBe("UNSAFE_SQL");
  return String(result.failure.details.blockedConstruct);
};

describe("accepted statements (§6 allow list)", () => {
  it("accepts the canonical aggregate with comments and a trailing semicolon", () => {
    const result = inspect(`
      -- churn by tickets (prd.md §6.1)
      ${saasChurnPreset.datasetId === "saas_churn" ? "" : ""}
      SELECT tickets, COUNT(*) FROM saas_churn GROUP BY tickets ORDER BY tickets;
    `);
    expect(result.ok).toBe(true);
  });

  it("accepts WITH/CTE statements over the authorized relation", () => {
    const result = inspect(`
      WITH high AS (SELECT tickets, mrr FROM saas_churn WHERE mrr > 500)
      SELECT COUNT(*) AS n FROM high
    `);
    expect(result.ok).toBe(true);
  });

  it("accepts a CTE with an explicit column list", () => {
    const result = inspect(`
      WITH t(tickets) AS (SELECT tickets FROM saas_churn)
      SELECT tickets FROM t
    `);
    expect(result.ok).toBe(true);
  });

  it("accepts a self-join of the authorized relation with aliases", () => {
    const result = inspect(`
      SELECT COUNT(*) FROM saas_churn a JOIN saas_churn b ON a.tenant_id = b.tenant_id WHERE a.tickets > 3
    `);
    expect(result.ok).toBe(true);
  });
});

describe("rejection: statement count (pinned order 1)", () => {
  it("rejects two statements separated by a semicolon", () => {
    expect(unsafeConstruct(inspect("SELECT 1; DROP TABLE saas_churn"))).toBe("multiple_statements");
  });

  it("rejects a hidden second statement after a newline", () => {
    expect(unsafeConstruct(inspect("SELECT tickets FROM saas_churn;\nDELETE FROM saas_churn"))).toBe(
      "multiple_statements",
    );
  });
});

describe("rejection: head keyword (pinned order 2)", () => {
  it.each(["ATTACH 'x.db' AS x", "COPY saas_churn TO '/tmp/x.csv'", "INSTALL httpfs", "PRAGMA version", "SHOW TABLES"])(
    "rejects %s before any construct scan",
    (sql) => {
      expect(unsafeConstruct(inspect(sql))).toBe("head_keyword");
    },
  );

  it("rejects an empty statement as malformed, not unsafe", () => {
    const result = inspect("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_ERROR");
  });
});

describe("rejection: forbidden constructs (pinned order 3)", () => {
  it.each([
    ["CREATE TABLE t AS SELECT * FROM saas_churn", "head_keyword"],
    ["INSERT INTO saas_churn VALUES (1)", "head_keyword"],
    ["UPDATE saas_churn SET tickets = 0", "head_keyword"],
    ["DELETE FROM saas_churn", "head_keyword"],
    ["BEGIN TRANSACTION", "head_keyword"],
    ["ATTACH 'x.db' AS x (TYPE sqlite)", "head_keyword"],
    // Mid-statement mutations pass the head check and die on the scan:
    ["WITH t AS (SELECT * FROM saas_churn) DELETE FROM t", "delete"],
    ["SELECT * FROM saas_churn INTO t2", "into"],
    ["SELECT * FROM saas_churn WHERE EXISTS (DELETE FROM saas_churn)", "delete"],
  ])("rejects %s", (sql, construct) => {
    expect(unsafeConstruct(inspect(sql))).toBe(construct);
  });

  it("rejects URL literals and external scans even inside a legal head", () => {
    expect(unsafeConstruct(inspect("SELECT * FROM read_csv('https://example.com/x.csv')"))).toBe("external_scan");
    expect(unsafeConstruct(inspect("SELECT * FROM parquet_scan('s3://bucket/x')"))).toBe("external_scan");
    expect(unsafeConstruct(inspect("SELECT 'https://example.com/exfil'"))).toBe("external_url");
    expect(unsafeConstruct(inspect("SELECT * FROM glob('/etc/*')"))).toBe("external_scan");
  });

  it("cannot be fooled by keywords inside string literals or comments", () => {
    const result = inspect(`
      SELECT 'DROP TABLE saas_churn' AS note -- ATTACH 'x.db'
      FROM saas_churn WHERE region = /* COPY */ 'na'
    `);
    expect(result.ok).toBe(true);
  });
});

describe("rejection: relation references (pinned order 4)", () => {
  it("rejects a reference outside the authorized set", () => {
    const result = inspect("SELECT diagnosis FROM healthcare_pii");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("DATASET_UNAVAILABLE");
      expect(result.failure.details.relation).toBe("healthcare_pii");
    }
  });

  it("rejects table functions and unknown relations in FROM", () => {
    const result = inspect("SELECT * FROM generate_series(10)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("DATASET_UNAVAILABLE");
  });

  it("rejects a comma-separated second relation", () => {
    const result = inspect("SELECT * FROM saas_churn, healthcare_pii");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("DATASET_UNAVAILABLE");
  });

  it("denies a foreign relation hidden behind AS MATERIALIZED instead of skipping the scan", () => {
    const result = inspect("WITH t AS MATERIALIZED (SELECT * FROM healthcare_pii) SELECT COUNT(*) FROM t");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("DATASET_UNAVAILABLE");
      expect(result.failure.details.relation).toBe("healthcare_pii");
    }
  });
});

describe("CTE header parsing fails closed (pinned order 4)", () => {
  it("fails closed when the CTE name is not an identifier", () => {
    expect(unsafeConstruct(inspect("WITH 1 AS (SELECT 1) SELECT 1"))).toBe("cte_header");
  });

  it("fails closed when AS is not followed by a parenthesized body", () => {
    expect(unsafeConstruct(inspect("WITH t AS SELECT 1 SELECT * FROM t"))).toBe("cte_header");
  });

  it("accepts the legal AS MATERIALIZED spelling", () => {
    expect(inspect("WITH t AS MATERIALIZED (SELECT 1 AS x) SELECT * FROM t").ok).toBe(true);
  });

  it("accepts the legal AS NOT MATERIALIZED spelling", () => {
    expect(inspect("WITH t AS NOT MATERIALIZED (SELECT 1 AS x) SELECT * FROM t").ok).toBe(true);
  });

  it("keeps accepting the plain WITH spelling", () => {
    expect(inspect("WITH t AS (SELECT 1 AS x) SELECT * FROM t").ok).toBe(true);
  });
});

describe("rejection: binding interpolation (pinned order 5)", () => {
  it("rejects a binding reference pasted inside a string literal", () => {
    const result = inspect("SELECT * FROM saas_churn WHERE region = '$region'", { region: "na" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_ERROR");
      expect(result.failure.details.reason).toBe("interpolated_binding");
    }
  });

  it("rejects template interpolation and positional references", () => {
    const interpolated = inspect("SELECT * FROM saas_churn WHERE region = ${region}", { region: "na" });
    expect(interpolated.ok).toBe(false);
    if (!interpolated.ok) expect(interpolated.failure.code).toBe("VALIDATION_ERROR");
    const positional = inspect("SELECT * FROM saas_churn WHERE tickets > $1", { min: 5 });
    expect(positional.ok).toBe(false);
    if (!positional.ok) {
      expect(positional.failure.code).toBe("VALIDATION_ERROR");
      expect(positional.failure.details.reason).toBe("positional_ref");
    }
  });

  it("rejects a referenced binding that is not supplied", () => {
    const result = inspect("SELECT * FROM saas_churn WHERE region = $region", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_ERROR");
      expect(result.failure.details.field).toBe("region");
    }
  });
});

describe("named → positional binding rewrite (grilling 21)", () => {
  it("orders positionals by first appearance, left to right", () => {
    const result = inspect(
      "SELECT * FROM saas_churn WHERE region = $region AND tickets >= $min AND plan = $region",
      { min: 5, region: "na" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inspection.bindingOrder).toEqual(["region", "min"]);
      expect(result.inspection.positionalSql).toBe(
        "SELECT * FROM saas_churn WHERE region = $1 AND tickets >= $2 AND plan = $1",
      );
    }
  });

  it("leaves a literal dollar amount inside prose untouched", () => {
    const result = inspect("SELECT * FROM saas_churn WHERE mrr > $min", { min: 5 });
    expect(result.ok).toBe(true);
  });

  it("records grouping shape and aggregate presence for the release pipeline", () => {
    const grouped = inspect("SELECT tickets, COUNT(*) FROM saas_churn GROUP BY tickets");
    expect(grouped.ok && grouped.inspection.hasGrouping).toBe(true);
    expect(grouped.ok && grouped.inspection.groupExpressions).toEqual(["tickets"]);
    const rowwise = inspect("SELECT tickets FROM saas_churn WHERE tickets > $min", { min: 5 });
    expect(rowwise.ok && rowwise.inspection.hasAggregate).toBe(false);
    const aggregate = inspect("SELECT AVG(mrr) FROM saas_churn");
    expect(aggregate.ok && aggregate.inspection.hasAggregate).toBe(true);
  });
});

describe("lexer (defense against smuggling)", () => {
  it("never yields word tokens from string or comment content", () => {
    const tokens = lexSql("SELECT 'DROP TABLE x' -- DELETE FROM y /* INSTALL z */ FROM saas_churn");
    const words = tokens.filter((token) => token.kind === "word").map((token) => token.text.toUpperCase());
    expect(words).not.toContain("DROP");
    expect(words).not.toContain("DELETE");
    expect(words).not.toContain("INSTALL");
  });
});
