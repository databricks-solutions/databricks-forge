"use client";

import * as React from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "next-themes";

interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onRun?: () => void;
  className?: string;
}

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  },
  ".cm-gutters": { borderRight: "1px solid var(--border)", backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
});

export function SqlEditor({ value, onChange, readOnly = false, onRun, className }: SqlEditorProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const { resolvedTheme } = useTheme();
  const onChangeRef = React.useRef(onChange);
  const onRunRef = React.useRef(onRun);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  React.useEffect(() => {
    if (!containerRef.current) return;

    const isDark = resolvedTheme === "dark";

    const runKeymap = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          onRunRef.current?.();
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        sql({ dialect: StandardSQL }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        baseTheme,
        themeCompartment.of(isDark ? oneDark : []),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        runKeymap,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Re-create only when theme changes; value/readOnly are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-md border bg-muted ${className ?? ""}`}
    />
  );
}
