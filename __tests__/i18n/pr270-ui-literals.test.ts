import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const TARGETS = [
  "app/environment/page.tsx",
  "app/environment/programs/[programId]/page.tsx",
  "components/environment/domain-explorer.tsx",
  "components/environment/relationships-view.tsx",
  "components/environment/state-of-the-nation.tsx",
  "components/portfolio/manage-access-dialog.tsx",
  "components/portfolio/portfolio-state-of-the-nation.tsx",
  "components/environment/include-patterns-input.tsx",
  "app/configure/page.tsx",
] as const;

const USER_VISIBLE_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "placeholder",
  "title",
  "alt",
  "label",
  "description",
  "emptyLabel",
  "hint",
  "tooltip",
  "message",
  "text",
]);

// Product names and terse technical codes are intentionally not translated.
const ALLOWLIST = new Set([
  "Databricks",
  "Forge",
  "Unity Catalog",
  "CDF",
  "PDF",
  "Excel",
  "ERD",
]);

function isAllowed(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return !/[A-Za-zÀ-ÿ]/.test(normalized) || ALLOWLIST.has(normalized);
}

function scan(file: string): string[] {
  const absolute = path.join(ROOT, file);
  const sourceText = fs.readFileSync(absolute, "utf8");
  return scanSource(file, sourceText);
}

function scanSource(file: string, sourceText: string): string[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: string[] = [];
  const reported = new Set<number>();

  const report = (node: ts.Node, kind: string, value: string) => {
    if (isAllowed(value)) return;
    if (reported.has(node.getStart(source))) return;
    reported.add(node.getStart(source));
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push(`${file}:${line + 1} ${kind}: ${JSON.stringify(value.replace(/\s+/g, " ").trim())}`);
  };

  const isTranslationCall = (node: ts.CallExpression): boolean => {
    const callee = node.expression.getText(source);
    return callee === "t" || callee === "tr" || callee.endsWith(".rich");
  };

  const reportExpressionLiterals = (node: ts.Node, kind: string) => {
    const STRUCTURAL_CALLBACKS = new Set([
      "map",
      "flatMap",
      "filter",
      "some",
      "every",
      "find",
      "findIndex",
      "reduce",
      "sort",
    ]);

    const walkRenderedCallback = (callback: ts.Node) => {
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return;
      if (!ts.isBlock(callback.body)) {
        walk(callback.body);
        return;
      }
      const findReturns = (current: ts.Node) => {
        if (current !== callback.body && ts.isFunctionLike(current)) return;
        if (ts.isReturnStatement(current) && current.expression) {
          walk(current.expression);
          return;
        }
        ts.forEachChild(current, findReturns);
      };
      findReturns(callback.body);
    };

    const walk = (current: ts.Node) => {
      if (ts.isCallExpression(current) && isTranslationCall(current)) return;
      if (ts.isCallExpression(current)) {
        const method =
          ts.isPropertyAccessExpression(current.expression) &&
          STRUCTURAL_CALLBACKS.has(current.expression.name.text)
            ? current.expression.name.text
            : null;
        const callback = current.arguments[0];
        const hasCallback =
          !!callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));

        if (method && hasCallback) {
          // Structural callback predicates are code, not copy. Map/flatMap
          // returns and reduce returns/initial accumulators become rendered
          // output, so inspect those paths explicitly.
          if (method === "map" || method === "flatMap") {
            walkRenderedCallback(callback);
          } else if (method === "reduce") {
            walkRenderedCallback(callback);
            current.arguments.slice(1).forEach(walk);
          }
          return;
        }

        // Arbitrary helpers (including nested calls and built-ins such as
        // String()) can wrap visible copy, so their arguments must be scanned.
        current.arguments.forEach(walk);
        return;
      }
      if (ts.isJsxElement(current)) {
        current.children.forEach(walk);
        return;
      }
      if (ts.isJsxFragment(current)) {
        current.children.forEach(walk);
        return;
      }
      if (ts.isJsxSelfClosingElement(current) || ts.isJsxAttribute(current)) return;
      if (ts.isConditionalExpression(current)) {
        walk(current.whenTrue);
        walk(current.whenFalse);
        return;
      }
      if (
        ts.isBinaryExpression(current) &&
        (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      ) {
        walk(current.right);
        return;
      }
      if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
        report(current, kind, current.text);
        return;
      }
      if (ts.isTemplateExpression(current)) {
        report(current.head, kind, current.head.text);
        for (const span of current.templateSpans) {
          walk(span.expression);
          report(span.literal, kind, span.literal.text);
        }
        return;
      }
      ts.forEachChild(current, walk);
    };
    walk(node);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      report(node, "JSX text", node.getText(source));
    } else if (
      ts.isJsxAttribute(node) &&
      USER_VISIBLE_ATTRIBUTES.has(node.name.getText(source)) &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) {
        report(node, node.name.getText(source), node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        reportExpressionLiterals(node.initializer.expression, `${node.name.getText(source)} expression`);
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      // Includes native SVG <title>{`...`}</title>, conditional/logical JSX
      // children, and user-visible strings nested in expression containers.
      reportExpressionLiterals(node.expression, "JSX expression");
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === "toast"
    ) {
      const first = node.arguments[0];
      if (first) reportExpressionLiterals(first, `toast.${node.expression.name.text}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
}

describe("PR #270 UI strings", () => {
  it("externalizes JSX children, visible props, accessibility labels, and every toast variant", () => {
    const findings = TARGETS.flatMap(scan);
    expect(findings, findings.join("\n")).toEqual([]);
  });
});

describe("literal scanner mutation fixtures", () => {
  const translatableWords = [
    "rows",
    "tables",
    "size",
    "tier",
    "catalog",
    "sourced",
    "benchmark",
  ];

  it.each(translatableWords)("rejects visible JSX text %j", (word) => {
    expect(scanSource("fixture.tsx", `export const X = () => <div>${word}</div>`)).not.toEqual([]);
  });

  it.each(translatableWords)("rejects visible prop text %j", (word) => {
    expect(
      scanSource("fixture.tsx", `export const X = () => <Metric label=\"${word}\" />`),
    ).not.toEqual([]);
  });

  it.each(translatableWords)("rejects visible template text %j", (word) => {
    expect(
      scanSource("fixture.tsx", `export const X = () => <title>{\`${word}\`}</title>`),
    ).not.toEqual([]);
  });

  it.each(translatableWords)("rejects literals wrapped in visible helper calls %j", (word) => {
    expect(
      scanSource("fixture.tsx", `export const X = () => <div>{formatLabel("${word}")}</div>`),
    ).not.toEqual([]);
  });

  it("rejects visible prop literals wrapped in built-in calls", () => {
    expect(
      scanSource("fixture.tsx", `export const X = () => <Metric label={String("tables")} />`),
    ).not.toEqual([]);
  });

  it("rejects nested helper template literals", () => {
    expect(
      scanSource("fixture.tsx", "export const X = () => <div>{outer(inner(`size`))}</div>"),
    ).not.toEqual([]);
  });

  it("rejects helper-wrapped toast literals", () => {
    expect(
      scanSource("fixture.tsx", `export const run = () => toast.error(formatLabel("tier"))`),
    ).not.toEqual([]);
  });

  it("rejects wrapped visible output inside a structural map callback", () => {
    const fixture = `
      const METRICS = ["rows"] as const;
      export const X = () => (
        <div>{METRICS.map((metric) => <span>{formatLabel("rows")}</span>)}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).not.toEqual([]);
  });

  it("allows internal enum arrays that select translated labels", () => {
    const fixture = `
      const METRICS = ["rows", "tables", "size", "tier", "catalog"] as const;
      export const X = () => (
        <div>{METRICS.map((metric) => <span key={metric}>{t(\`metric.\${metric}\`)}</span>)}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).toEqual([]);
  });

  it("allows filter/map callback machinery when rendered output is translated", () => {
    const fixture = `
      const METRICS = ["rows", "tables"] as const;
      export const X = () => (
        <div>
          {METRICS.filter((metric) => metric === "rows").map(
            (metric) => <span key={metric}>{t(\`metric.\${metric}\`)}</span>
          )}
        </div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).toEqual([]);
  });

  it("rejects a visible literal directly returned from reduce", () => {
    const fixture = `
      export const X = ({items}: {items: string[]}) => (
        <div>{items.reduce((acc) => "rows", "")}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).not.toEqual([]);
  });

  it("rejects a visible template returned from a reduce block", () => {
    const fixture = `
      export const X = ({items}: {items: string[]}) => (
        <div>{items.reduce((acc) => { return \`tables\`; }, "")}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).not.toEqual([]);
  });

  it("rejects a visible initial reduce accumulator", () => {
    const fixture = `
      export const X = ({items}: {items: string[]}) => (
        <div>{items.reduce((acc) => acc, "size")}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).not.toEqual([]);
  });

  it("rejects nested helper calls returned from reduce", () => {
    const fixture = `
      export const X = ({items}: {items: string[]}) => (
        <div>{items.reduce((acc) => outer(inner("tier")), "")}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).not.toEqual([]);
  });

  it("allows translated reduce output with an empty accumulator", () => {
    const fixture = `
      const METRICS = ["rows", "tables"] as const;
      export const X = () => (
        <div>{METRICS.reduce((acc, metric) => \`\${acc}\${t(\`metric.\${metric}\`)}\`, "")}</div>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).toEqual([]);
  });

  it("allows internal evidence codes used only in control flow", () => {
    const fixture = `
      type Tier = "sourced" | "benchmark";
      export const X = ({tier}: {tier: Tier}) => (
        <span>{tier === "sourced" ? t("evidence.sourced") : t("evidence.benchmark")}</span>
      );
    `;
    expect(scanSource("fixture.tsx", fixture)).toEqual([]);
  });
});
