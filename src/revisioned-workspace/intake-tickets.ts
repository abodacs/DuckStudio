import { sha256Hex } from "../analysis-artifacts/sql-hash";

/**
 * The out-of-band intake channel for local file drops (slice 7, prd
 * Amendment 3): the human adapter reads the dropped file's bytes in this tab,
 * puts them under a one-shot ticket, and dispatches `importLocalFile` with
 * the handle — the command input never carries the bytes, so the domain
 * command stays JSON-shaped (§8.5). The store consumes the ticket exactly
 * once, inside the import's execution: consumption deletes the bytes
 * immediately, so a failed or cancelled import leaves zero trace, and an
 * exact idempotent replay answers from the envelope cache without ever
 * needing the bytes again.
 *
 * The registry is a store port (injected like kernel/engine in tests); the
 * exported binding is the one app instance the human adapter holds.
 */

export interface IntakeTicket {
  /** The file's bytes — read in-tab, never leaving the browser. */
  readonly bytes: Uint8Array;
  /** Content-sensitive digest; the store derives the relation suffix from it. */
  readonly digest: string;
}

export interface IntakeRegistry {
  /** Puts the bytes under a fresh ticket; returns the handle and its digest. */
  put(name: string, bytes: Uint8Array): { ticketId: string; digest: string };
  /** One-shot read: the ticket is returned and deleted in the same call. */
  consume(ticketId: string): IntakeTicket | undefined;
  /** Hard delete — the human adapter's finally guarantees no leaked bytes. */
  delete(ticketId: string): void;
}

/** Amendment 3's import byte ceiling: 200 MB, checked before the engine sees the file. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/**
 * The ticket digest: SHA-256 over the name, the byte length, and the first
 * and last 4 KB of decoded text. Content-sensitive where it matters (two
 * different files behind one slug must derive different relations) without
 * hashing 200 MB through the synchronous hash.
 */
export function intakeDigest(name: string, bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  const head = decoder.decode(bytes.slice(0, 4096));
  const tail = decoder.decode(bytes.slice(Math.max(0, bytes.byteLength - 4096)));
  return sha256Hex(`${name}\n${bytes.byteLength}\n${head}\n${tail}`);
}

/**
 * The imported dataset's identity: `local_<slug>_<4 hex>` — the slugified
 * file stem, differentiated by the ticket digest so `my sales.csv` and
 * `my-sales.csv` (same slug, different files) never collide, while
 * re-importing the same file rebuilds the same relation (CREATE OR REPLACE).
 * The relation doubles as the datasetId, so the preset invariant "the
 * relation is the datasetId" holds for imports too and the authorized
 * relation is copy-pasteable into SQL.
 */
export function importedRelationName(name: string, digest: string): string {
  const slug =
    name
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "file";
  return `local_${slug}_${digest.slice(0, 4)}`;
}

export function createIntakeRegistry(): IntakeRegistry {
  const tickets = new Map<string, IntakeTicket>();
  return {
    put(name, bytes) {
      const ticketId = crypto.randomUUID();
      const digest = intakeDigest(name, bytes);
      tickets.set(ticketId, Object.freeze({ bytes, digest }));
      return { ticketId, digest };
    },
    consume(ticketId) {
      const ticket = tickets.get(ticketId);
      tickets.delete(ticketId);
      return ticket;
    },
    delete(ticketId) {
      tickets.delete(ticketId);
    },
  };
}

/** The one app binding; the human adapter (`live-canvas/human-commands.ts`) holds it. */
export const intakeTickets: IntakeRegistry = createIntakeRegistry();
