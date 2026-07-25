"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type {
  GenieEngineConfig,
  GlossaryEntry,
  CustomSqlExpression,
  ClarificationRule,
  ColumnOverride,
  BenchmarkInput,
} from "@/lib/genie/types";

interface GenieConfigEditorProps {
  config: GenieEngineConfig;
  onChange: (config: GenieEngineConfig) => void;
  disabled?: boolean;
}

export function GenieConfigEditor({ config, onChange, disabled }: GenieConfigEditorProps) {
  const update = (partial: Partial<GenieEngineConfig>) => {
    onChange({ ...config, ...partial });
  };

  if (disabled) {
    return (
      <div className="rounded-lg border-2 border-dashed border-muted p-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">Genie Engine is disabled</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Enable the Genie Engine in global Settings to configure per-run parameters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-muted-foreground">
        Engine toggles, entity matching, fiscal year, and trusted asset settings are configured in
        global <span className="font-semibold">Settings</span>. Per-run overrides below let you
        customise glossary, SQL, column metadata, benchmarks, and instructions.
      </p>
      <Accordion type="multiple" defaultValue={["glossary"]} className="w-full">
        {/* Business Glossary */}
        <AccordionItem value="glossary">
          <AccordionTrigger className="text-sm font-medium">
            Business Glossary ({config.glossary.length} terms)
          </AccordionTrigger>
          <AccordionContent>
            <GlossaryEditor
              entries={config.glossary}
              onChange={(glossary) => update({ glossary })}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Custom SQL Expressions */}
        <AccordionItem value="expressions">
          <AccordionTrigger className="text-sm font-medium">
            Custom SQL Expressions (
            {config.customMeasures.length +
              config.customFilters.length +
              config.customDimensions.length}
            )
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              <SqlExpressionEditor
                label="Measures"
                expressions={config.customMeasures}
                onChange={(customMeasures) => update({ customMeasures })}
              />
              <Separator />
              <SqlExpressionEditor
                label="Filters"
                expressions={config.customFilters}
                onChange={(customFilters) => update({ customFilters })}
              />
              <Separator />
              <SqlExpressionEditor
                label="Dimensions"
                expressions={config.customDimensions}
                onChange={(customDimensions) => update({ customDimensions })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Clarification Rules */}
        <AccordionItem value="clarification">
          <AccordionTrigger className="text-sm font-medium">
            Clarification Rules ({config.clarificationRules.length})
          </AccordionTrigger>
          <AccordionContent>
            <ClarificationEditor
              rules={config.clarificationRules}
              onChange={(clarificationRules) => update({ clarificationRules })}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Column Overrides */}
        <AccordionItem value="columns">
          <AccordionTrigger className="text-sm font-medium">
            Column Overrides ({config.columnOverrides.length})
          </AccordionTrigger>
          <AccordionContent>
            <ColumnOverridesEditor
              overrides={config.columnOverrides}
              onChange={(columnOverrides) => update({ columnOverrides })}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Benchmark Questions */}
        <AccordionItem value="benchmarks">
          <AccordionTrigger className="text-sm font-medium">
            Benchmark Questions ({config.benchmarkQuestions.length})
          </AccordionTrigger>
          <AccordionContent>
            <BenchmarkEditor
              benchmarks={config.benchmarkQuestions}
              onChange={(benchmarkQuestions) => update({ benchmarkQuestions })}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Instructions */}
        <AccordionItem value="instructions">
          <AccordionTrigger className="text-sm font-medium">
            Instructions & Summary
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-xs">Global Instructions</Label>
                <Textarea
                  value={config.globalInstructions}
                  onChange={(e) => update({ globalInstructions: e.target.value })}
                  placeholder="Additional instructions for all Genie spaces in this run..."
                  className="min-h-[80px] text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Summary Customization</Label>
                <Textarea
                  value={config.summaryInstructions}
                  onChange={(e) => update({ summaryInstructions: e.target.value })}
                  placeholder="Instructions for how Genie should format summaries..."
                  className="min-h-[80px] text-sm"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GlossaryEditor({
  entries,
  onChange,
}: {
  entries: GlossaryEntry[];
  onChange: (entries: GlossaryEntry[]) => void;
}) {
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");
  const [newSynonyms, setNewSynonyms] = useState("");

  const addEntry = () => {
    if (!newTerm.trim() || !newDef.trim()) return;
    onChange([
      ...entries,
      {
        term: newTerm.trim(),
        definition: newDef.trim(),
        synonyms: newSynonyms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    ]);
    setNewTerm("");
    setNewDef("");
    setNewSynonyms("");
  };

  const removeEntry = (idx: number) => {
    onChange(entries.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 py-2">
      {entries.map((entry, idx) => (
        <div key={idx} className="flex items-start gap-2 rounded border p-2 text-xs">
          <div className="flex-1">
            <span className="font-semibold">{entry.term}</span>: {entry.definition}
            {entry.synonyms.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.synonyms.map((s, si) => (
                  <Badge key={si} variant="outline" className="text-[9px]">
                    {s}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => removeEntry(idx)}
            className="text-destructive hover:text-destructive/80"
            aria-label="Remove"
          >
            &times;
          </button>
        </div>
      ))}

      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="Term"
            className="h-7 text-xs"
          />
          <Input
            value={newSynonyms}
            onChange={(e) => setNewSynonyms(e.target.value)}
            placeholder="Synonyms (comma-separated)"
            className="h-7 text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={newDef}
            onChange={(e) => setNewDef(e.target.value)}
            placeholder="Definition"
            className="h-7 flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
          />
          <Button size="sm" variant="outline" onClick={addEntry} className="h-7 text-xs">
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function SqlExpressionEditor({
  label,
  expressions,
  onChange,
}: {
  label: string;
  expressions: CustomSqlExpression[];
  onChange: (expressions: CustomSqlExpression[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newSql, setNewSql] = useState("");

  const addExpression = () => {
    if (!newName.trim() || !newSql.trim()) return;
    onChange([
      ...expressions,
      { name: newName.trim(), sql: newSql.trim(), synonyms: [], instructions: "" },
    ]);
    setNewName("");
    setNewSql("");
  };

  const removeExpression = (idx: number) => {
    onChange(expressions.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      {expressions.map((expr, idx) => (
        <div key={idx} className="flex items-center gap-2 rounded border p-2 text-xs">
          <div className="flex-1">
            <span className="font-mono font-semibold">{expr.name}</span>
            <pre className="mt-1 rounded bg-muted/50 p-1 text-[10px]">{expr.sql}</pre>
          </div>
          <button
            onClick={() => removeExpression(idx)}
            className="text-destructive hover:text-destructive/80"
            aria-label="Remove"
          >
            &times;
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name"
          className="h-7 w-40 text-xs"
        />
        <Input
          value={newSql}
          onChange={(e) => setNewSql(e.target.value)}
          placeholder="SQL expression"
          className="h-7 flex-1 font-mono text-xs"
          onKeyDown={(e) => e.key === "Enter" && addExpression()}
        />
        <Button size="sm" variant="outline" onClick={addExpression} className="h-7 text-xs">
          Add
        </Button>
      </div>
    </div>
  );
}

function ClarificationEditor({
  rules,
  onChange,
}: {
  rules: ClarificationRule[];
  onChange: (rules: ClarificationRule[]) => void;
}) {
  const [newTopic, setNewTopic] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [newQuestion, setNewQuestion] = useState("");

  const addRule = () => {
    if (!newTopic.trim() || !newQuestion.trim()) return;
    onChange([
      ...rules,
      {
        topic: newTopic.trim(),
        missingDetails: newDetails
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        clarificationQuestion: newQuestion.trim(),
      },
    ]);
    setNewTopic("");
    setNewDetails("");
    setNewQuestion("");
  };

  const removeRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 py-2">
      {rules.map((rule, idx) => (
        <div key={idx} className="flex items-start gap-2 rounded border p-2 text-xs">
          <div className="flex-1">
            <span className="font-semibold">When asking about:</span> {rule.topic}
            <br />
            <span className="text-muted-foreground">Missing: {rule.missingDetails.join(", ")}</span>
            <br />
            <span className="italic">&quot;{rule.clarificationQuestion}&quot;</span>
          </div>
          <button onClick={() => removeRule(idx)} className="text-destructive" aria-label="Remove">
            &times;
          </button>
        </div>
      ))}

      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Topic (e.g., 'sales performance')"
            className="h-7 text-xs"
          />
          <Input
            value={newDetails}
            onChange={(e) => setNewDetails(e.target.value)}
            placeholder="Missing details (comma-separated)"
            className="h-7 text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Clarification question to ask"
            className="h-7 flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && addRule()}
          />
          <Button size="sm" variant="outline" onClick={addRule} className="h-7 text-xs">
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function ColumnOverridesEditor({
  overrides,
  onChange,
}: {
  overrides: ColumnOverride[];
  onChange: (overrides: ColumnOverride[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [newFqn, setNewFqn] = useState("");
  const [newCol, setNewCol] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newSynonyms, setNewSynonyms] = useState("");
  const [newHidden, setNewHidden] = useState(false);

  const filtered = search.trim()
    ? overrides.filter(
        (o) =>
          o.tableFqn.toLowerCase().includes(search.toLowerCase()) ||
          o.columnName.toLowerCase().includes(search.toLowerCase()) ||
          (o.displayName ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : overrides;

  const addOverride = () => {
    if (!newFqn.trim() || !newCol.trim()) return;
    onChange([
      ...overrides,
      {
        tableFqn: newFqn.trim(),
        columnName: newCol.trim(),
        displayName: newDisplay.trim() || undefined,
        synonyms: newSynonyms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        hidden: newHidden,
      },
    ]);
    setNewFqn("");
    setNewCol("");
    setNewDisplay("");
    setNewSynonyms("");
    setNewHidden(false);
  };

  const removeOverride = (idx: number) => {
    const original = overrides.findIndex(
      (o) => o.tableFqn === filtered[idx].tableFqn && o.columnName === filtered[idx].columnName,
    );
    if (original >= 0) onChange(overrides.filter((_, i) => i !== original));
  };

  const toggleHidden = (idx: number) => {
    const target = filtered[idx];
    onChange(
      overrides.map((o) =>
        o.tableFqn === target.tableFqn && o.columnName === target.columnName
          ? { ...o, hidden: !o.hidden }
          : o,
      ),
    );
  };

  return (
    <div className="space-y-3 py-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search columns..."
        className="h-7 text-xs"
      />

      {filtered.length > 0 && (
        <div className="max-h-48 space-y-1 overflow-auto">
          {filtered.map((o, idx) => (
            <div
              key={`${o.tableFqn}.${o.columnName}`}
              className="flex items-center gap-2 rounded border p-1.5 text-xs"
            >
              <button
                onClick={() => toggleHidden(idx)}
                className={`h-4 w-4 shrink-0 rounded border text-[8px] leading-none ${
                  o.hidden
                    ? "bg-red-100 text-red-500 border-red-300"
                    : "bg-green-100 text-green-600 border-green-300"
                }`}
                title={o.hidden ? "Hidden — click to show" : "Visible — click to hide"}
              >
                {o.hidden ? "H" : "V"}
              </button>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {o.tableFqn}.{o.columnName}
              </span>
              {o.displayName && <span className="text-[10px]">&rarr; {o.displayName}</span>}
              {o.synonyms && o.synonyms.length > 0 && (
                <span className="flex gap-0.5">
                  {o.synonyms.map((s, si) => (
                    <Badge key={si} variant="outline" className="text-[8px]">
                      {s}
                    </Badge>
                  ))}
                </span>
              )}
              <button
                onClick={() => removeOverride(idx)}
                className="ml-auto text-destructive hover:text-destructive/80"
                aria-label="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <div className="grid grid-cols-3 gap-2">
          <Input
            value={newFqn}
            onChange={(e) => setNewFqn(e.target.value)}
            placeholder="catalog.schema.table"
            className="h-7 font-mono text-xs"
          />
          <Input
            value={newCol}
            onChange={(e) => setNewCol(e.target.value)}
            placeholder="column_name"
            className="h-7 font-mono text-xs"
          />
          <Input
            value={newDisplay}
            onChange={(e) => setNewDisplay(e.target.value)}
            placeholder="Display name (optional)"
            className="h-7 text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={newSynonyms}
            onChange={(e) => setNewSynonyms(e.target.value)}
            placeholder="Synonyms (comma-separated)"
            className="h-7 flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && addOverride()}
          />
          <button
            type="button"
            onClick={() => setNewHidden(!newHidden)}
            className={`h-7 rounded border px-2 text-[10px] ${
              newHidden ? "border-red-300 bg-red-50 text-red-600" : "border-border"
            }`}
          >
            {newHidden ? "Hidden" : "Visible"}
          </button>
          <Button size="sm" variant="outline" onClick={addOverride} className="h-7 text-xs">
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function BenchmarkEditor({
  benchmarks,
  onChange,
}: {
  benchmarks: BenchmarkInput[];
  onChange: (benchmarks: BenchmarkInput[]) => void;
}) {
  const [newQuestion, setNewQuestion] = useState("");
  const [newSql, setNewSql] = useState("");
  const [newPhrasings, setNewPhrasings] = useState("");

  const addBenchmark = () => {
    if (!newQuestion.trim() || !newSql.trim()) return;
    onChange([
      ...benchmarks,
      {
        question: newQuestion.trim(),
        expectedSql: newSql.trim(),
        alternatePhrasings: newPhrasings
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    ]);
    setNewQuestion("");
    setNewSql("");
    setNewPhrasings("");
  };

  const removeBenchmark = (idx: number) => {
    onChange(benchmarks.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 py-2">
      <p className="text-[10px] text-muted-foreground">
        Add questions with expected SQL to evaluate Genie space accuracy. Auto-generated benchmarks
        from the engine will be merged with these.
      </p>

      {benchmarks.map((b, idx) => (
        <div key={idx} className="flex items-start gap-2 rounded border p-2 text-xs">
          <div className="flex-1 space-y-1">
            <p className="font-medium">{b.question}</p>
            <pre className="rounded bg-muted/50 p-1 font-mono text-[10px]">{b.expectedSql}</pre>
            {b.alternatePhrasings.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {b.alternatePhrasings.map((ap, ai) => (
                  <Badge key={ai} variant="outline" className="text-[9px]">
                    {ap}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => removeBenchmark(idx)}
            className="text-destructive hover:text-destructive/80"
            aria-label="Remove"
          >
            &times;
          </button>
        </div>
      ))}

      <div className="grid gap-2">
        <Input
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="Question (e.g., 'What was total revenue last month?')"
          className="h-7 text-xs"
        />
        <Textarea
          value={newSql}
          onChange={(e) => setNewSql(e.target.value)}
          placeholder="Expected SQL answer..."
          className="min-h-[60px] font-mono text-xs"
        />
        <div className="flex gap-2">
          <Input
            value={newPhrasings}
            onChange={(e) => setNewPhrasings(e.target.value)}
            placeholder="Alternate phrasings (comma-separated)"
            className="h-7 flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && addBenchmark()}
          />
          <Button size="sm" variant="outline" onClick={addBenchmark} className="h-7 text-xs">
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
