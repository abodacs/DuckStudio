import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";

/**
 * The CodeMirror SQL editor (stage 4; the only CodeMirror importer, mirroring
 * the chart.tsx ECharts rule — `workbench-view` lazy-loads this module so the
 * editor ships as its own chunk). Tab moves focus out of the editor
 * (`indentWithTab` indents only the statement inside); Cmd/Ctrl+Enter runs
 * the statement.
 */
export default function SqlEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  placeholder: string;
}): React.JSX.Element {
  const { value, onChange, onRun, placeholder: placeholderText } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  // Latest-callback refs sync in an effect: .current writes during render
  // break render purity (react-doctor/no-ref-current-in-render).
  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
  });

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      sql(),
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRunRef.current();
            return true;
          },
        },
        indentWithTab,
      ]),
      keymap.of(defaultKeymap),
      keymap.of(historyKeymap),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.lineWrapping,
      placeholder(placeholderText),
    ];
    const created = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current ?? document.createElement("div"),
    });
    setView(created);
    return () => {
      created.destroy();
      setView(null);
    };
    // The editor owns its document: value flows out through onChange and in
    // only when the prop differs from the document (external prefill).
    // Mount once.
  }, []);

  useEffect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value, view]);

  return <div ref={containerRef} className="wb-editor" />;
}
