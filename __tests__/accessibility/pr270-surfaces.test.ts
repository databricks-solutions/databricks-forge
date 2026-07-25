import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const TARGETS = [
  "app/environment/programs/[programId]/page.tsx",
  "components/environment/domain-explorer.tsx",
  "components/environment/relationships-view.tsx",
  "components/environment/state-of-the-nation.tsx",
  "components/portfolio/manage-access-dialog.tsx",
  "components/portfolio/portfolio-state-of-the-nation.tsx",
  "components/environment/include-patterns-input.tsx",
  "app/configure/page.tsx",
];

function source(file: string) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  return {
    text,
    ast: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
}

function importedLucideNames(ast: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  ast.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "lucide-react" &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        names.add(element.name.text);
      }
    }
  });
  return names;
}

function iconViolations(file: string): string[] {
  const { ast } = source(file);
  const icons = importedLucideNames(ast);
  const findings: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && icons.has(node.tagName.getText(ast))) {
      const hidden = node.attributes.properties.some(
        (p) =>
          ts.isJsxAttribute(p) &&
          p.name.getText(ast) === "aria-hidden" &&
          p.initializer?.getText(ast) === '"true"',
      );
      if (!hidden) {
        const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        findings.push(`${file}:${line + 1} ${node.tagName.getText(ast)} must be aria-hidden`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return findings;
}

describe("PR #270 accessibility contract", () => {
  it("marks decorative Lucide icons hidden from assistive technology", () => {
    const findings = TARGETS.flatMap(iconViolations);
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("keeps critical dialog/form/status affordances labelled and live", () => {
    const manage = source("components/portfolio/manage-access-dialog.tsx").text;
    expect(manage).toContain("<DialogDescription>");
    expect(manage).toContain('htmlFor="portfolio-admin-email"');
    expect(manage).toContain('id="portfolio-admin-email"');
    expect(manage).toContain('aria-live="polite"');

    const include = source("components/environment/include-patterns-input.tsx").text;
    expect(include).toContain('htmlFor="estate-include-pattern"');
    expect(include).toContain('id="estate-include-pattern"');
    expect(include).toContain('role="alert"');
    expect(include).toContain("min-h-11");

    const relationships = source("components/environment/relationships-view.tsx").text;
    expect(relationships).toContain("aria-pressed={filter === s.key}");
    expect(relationships).toContain("focus-visible:ring-2");

    const configure = source("app/configure/page.tsx").text;
    expect(configure).toContain('aria-live="polite"');
    expect(configure).toContain('aria-live="assertive"');
  });
});
