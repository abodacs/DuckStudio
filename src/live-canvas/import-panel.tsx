import { useRef, useState, type DragEvent } from "react";
import type { ImportFileVerdict } from "./human-commands";

/**
 * The local file dropzone (slice 7, prd Amendment 3): drag-and-drop or
 * click, CSV only, import never upload — the bytes are read in this tab and
 * nothing is ever sent, so the 0-Bytes badge stays truthful after an import.
 *
 * Self-contained by contract (slice-7 plan risk note): the panel renders the
 * dropzone, its never-imported onboard line, and its harden states — the
 * dispatch is a prop — so the stage-4 shell lifts it unchanged.
 */
export function ImportPanel({ importFile }: { importFile: (file: File) => Promise<ImportFileVerdict> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [failure, setFailure] = useState<Extract<ImportFileVerdict, { ok: false }> | null>(null);

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    setFailure(null);
    void importFile(file).then((verdict) => {
      if (!verdict.ok) setFailure(verdict);
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files.item(0));
  };

  return (
    <div className="mt-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-panel-inner border border-dashed px-3 py-4 transition-colors ${
          dragging ? "border-accent/60 bg-accent/[0.06]" : "border-edge bg-white/[0.02] hover:border-accent/40"
        }`}
      >
        <button
          type="button"
          className="w-full cursor-pointer rounded-panel-inner text-center focus-ring"
          onClick={() => inputRef.current?.click()}
        >
          <span className="block text-[13px] font-medium text-ink">Drop a CSV here — it never leaves this tab.</span>
          <span className="meta mt-1 block">or click to choose a file · CSV only · up to 200 MB</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="Import a local CSV file"
        className="sr-only"
        onChange={(event) => {
          handleFile(event.target.files?.item(0));
          event.target.value = "";
        }}
      />
      {failure && (
        <div role="alert" className="operation-card operation-card-failed mt-2">
          <p className="mt-1 flex items-center gap-2">
            <span className="chip-error">{failure.code}</span>
            <span className="meta">{failure.message}</span>
          </p>
        </div>
      )}
    </div>
  );
}
