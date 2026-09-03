import { afterAll, describe, expect, it, vi } from "vitest";
import { createNodeDuckRuntime, type NodeDuckRuntime } from "./node-duckdb";
import { createWorkerHandler, type DuckEngineRuntime } from "./worker-handler";
import {
  buildIntakeSql,
  classifyIntakeColumn,
  describeIntakeColumns,
  IntakeCeilingError,
  intakeFileName,
  materializedIntakeColumns,
  MAX_IMPORT_COLUMNS,
} from "./intake";
import type { EngineColumn } from "./protocol";

/**
 * The slice-7 intake engine contract: the name heuristic classifies direct
 * identifiers, the ceilings deny pre-execution, and — against real DuckDB
 * through the node runtime — the materialized relation omits the identifier
 * column entirely while the described metadata keeps it. The sniffer's type
 * inference is pinned here so retyping cannot drift silently.
 */

describe("intake classification (name heuristic, defense in depth)", () => {
  it("classifies direct identifiers across naming conventions", () => {
    for (const name of [
      "patient_id",
      "Patient ID",
      "patientid",
      "mrn",
      "MRN",
      "ssn",
      "SSN",
      "social_security_number",
      "email",
      "E-mail",
      "phone_number",
      "passport_no",
      "driver_license",
      "credit_card",
      "tax_id",
    ]) {
      expect(classifyIntakeColumn(name), name).toBe("direct_identifier");
    }
  });

  it("leaves analytic columns public", () => {
    for (const name of ["region", "amount", "tickets", "churned", "diagnosis", "visit_count", "total_mrr"]) {
      expect(classifyIntakeColumn(name), name).toBe("public");
    }
  });
});

describe("intake ceilings and SQL build", () => {
  const column = (name: string): EngineColumn => ({ name, type: "VARCHAR" });

  it("denies more than the column ceiling pre-execution", () => {
    const tooMany = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, index) => column(`c${index}`));
    expect(() => describeIntakeColumns(tooMany)).toThrow(IntakeCeilingError);
    expect(() => describeIntakeColumns(Array.from({ length: MAX_IMPORT_COLUMNS }, (_, index) => column(`c${index}`))))
      .not.toThrow();
  });

  it("denies an all-identifier file — there is nothing analyzable", () => {
    const described = describeIntakeColumns([column("ssn"), column("email")]);
    expect(() => materializedIntakeColumns(described)).toThrow(IntakeCeilingError);
  });

  it("builds an explicit projection that omits direct identifiers", () => {
    const described = describeIntakeColumns([column("patient_id"), { name: "amount", type: "DOUBLE" }]);
    expect(buildIntakeSql("local_x_ab12", "my_sales.csv", materializedIntakeColumns(described))).toBe(
      `CREATE OR REPLACE TABLE local_x_ab12 AS SELECT "amount" FROM read_csv('my_sales.csv')`,
    );
  });

  it("sanitizes the virtual file name", () => {
    expect(intakeFileName("my Sales 2026.csv")).toBe("my_Sales_2026.csv");
    expect(intakeFileName("no-extension")).toBe("no-extension.csv");
    expect(intakeFileName(".csv")).toBe("file.csv");
  });
});

describe("worker-handler intake translation", () => {
  const handlerRuntime = (impl: DuckEngineRuntime["intake"]): DuckEngineRuntime => ({
    warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
    runBounded: () => Promise.resolve({ schema: [], rows: [], executionMs: 1 }),
    materialize: () => Promise.resolve({ relationName: "x", rowCount: 0 }),
    drop: () => Promise.resolve(),
    intake: impl,
  });

  it("returns the intake result as an ok response", async () => {
    const response = await createWorkerHandler(
      handlerRuntime(() => Promise.resolve({ relationName: "local_x_ab12", rowCount: 3, columns: [] })),
    )({ id: 7, kind: "intake", relation: "local_x_ab12", name: "my_sales.csv", bytes: new Uint8Array() });
    expect(response).toMatchObject({ id: 7, kind: "intake", ok: true, result: { rowCount: 3 } });
  });

  it("translates IntakeCeilingError into a VALIDATION_ERROR failure with the human sentence", async () => {
    const response = await createWorkerHandler(
      handlerRuntime(() =>
        Promise.reject(new IntakeCeilingError("That file has 5,001 columns — the import ceiling is 5,000.", { columns: 5_001 })),
      ),
    )({ id: 8, kind: "intake", relation: "local_x_ab12", name: "wide.csv", bytes: new Uint8Array() });
    expect(response).toMatchObject({
      kind: "intake",
      ok: false,
      failure: {
        code: "VALIDATION_ERROR",
        message: "That file has 5,001 columns — the import ceiling is 5,000.",
        retryable: false,
        details: { columns: 5_001 },
      },
    });
  });

  it("translates any other intake error into an INTERNAL_ERROR, no engine message", async () => {
    const response = await createWorkerHandler(
      handlerRuntime(() => Promise.reject(new Error("IO Error: no such file 'wide.csv'"))),
    )({ id: 9, kind: "intake", relation: "local_x_ab12", name: "wide.csv", bytes: new Uint8Array() });
    expect(response).toMatchObject({ kind: "intake", ok: false, failure: { code: "INTERNAL_ERROR", retryable: true } });
    expect(JSON.stringify(response)).not.toContain("no such file");
  });
});

describe("real-DuckDB intake (node runtime): the relation omits the identifier column", () => {
  let runtime: NodeDuckRuntime;

  afterAll(async () => {
    await runtime?.dispose();
  });

  it("materializes the described columns minus direct identifiers, with sniffed types", async () => {
    runtime = await createNodeDuckRuntime();
    const csv = new TextEncoder().encode(
      ["patient_id,region,amount", "1,east,10.5", "2,west,20.0", "3,east,30.25", ""].join("\n"),
    );
    const result = await runtime.intake("local_patients_ab12", "patients.csv", csv);

    // The described metadata keeps every column, identifiers included.
    expect(result.relationName).toBe("local_patients_ab12");
    expect(result.rowCount).toBe(3);
    expect(result.columns).toEqual([
      { name: "patient_id", type: "BIGINT", classification: "direct_identifier" },
      { name: "region", type: "VARCHAR", classification: "public" },
      { name: "amount", type: "DOUBLE", classification: "public" },
    ]);

    // The relation itself never carries the identifier: SELECT * has no
    // patient_id column, and the analyzable values landed.
    const names = await runtime.runBounded(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'local_patients_ab12' ORDER BY column_name",
      [],
      100,
    );
    expect(names.rows.map((row) => row.column_name)).toEqual(["amount", "region"]);
    const rows = await runtime.runBounded("SELECT region, amount FROM local_patients_ab12 ORDER BY amount DESC", [], 100);
    expect(rows.rows).toEqual([
      { region: "east", amount: 30.25 },
      { region: "west", amount: 20.0 },
      { region: "east", amount: 10.5 },
    ]);
  });

  it("re-importing the same file rebuilds the same relation in place (CREATE OR REPLACE)", async () => {
    const csv = new TextEncoder().encode("region,amount\neast,1\nwest,2\n");
    await runtime.intake("local_patients_ab12", "patients.csv", csv);
    const again = await runtime.intake("local_patients_ab12", "patients.csv", csv);
    expect(again.rowCount).toBe(2);
  });

  it("leaves no relation behind when the intake fails", async () => {
    const bad = new TextEncoder().encode("patient_id,amount\n1\n"); // ragged row → sniffer/reader failure
    await expect(runtime.intake("local_ragged_cd34", "ragged.csv", bad)).rejects.toThrow();
    const names = await runtime.runBounded(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'local_ragged_cd34'",
      [],
      10,
    );
    expect(Number(names.rows[0]?.n)).toBe(0);
  });
});

// The node runtime's intake path above exercises the handler's verbatim
// dispatch too; the spy below pins that the handler passes the request
// through untouched (the engine re-derives nothing).
describe("worker-handler intake passes the request verbatim", () => {
  it("forwards relation, name, and bytes untouched", async () => {
    const intake = vi.fn(() =>
      Promise.resolve({ relationName: "local_x_ab12", rowCount: 0, columns: [] }),
    );
    const bytes = new TextEncoder().encode("a\n1\n");
    await createWorkerHandler({
      warm: () => Promise.resolve({ materializedRelations: [], warmMs: 0, materializationMs: 0 }),
      runBounded: () => Promise.resolve({ schema: [], rows: [], executionMs: 1 }),
      materialize: () => Promise.resolve({ relationName: "x", rowCount: 0 }),
      drop: () => Promise.resolve(),
      intake,
    })({ id: 1, kind: "intake", relation: "local_x_ab12", name: "my_sales.csv", bytes });
    expect(intake).toHaveBeenCalledWith("local_x_ab12", "my_sales.csv", bytes);
  });
});
