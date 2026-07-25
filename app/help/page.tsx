"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PageHeader } from "@/components/page-header";
import {
  ChevronDown,
  Lightbulb,
  Rocket,
  BarChart3,
  Database,
  Settings2,
  FileText,
  Sparkles,
  HelpCircle,
  BrainCircuit,
  Search,
  BookOpen,
  Keyboard,
  Globe,
  GitCompare,
  Map,
  LayoutDashboard,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Quick Start
// ---------------------------------------------------------------------------

const QUICK_START = [
  {
    step: 1,
    title: "Configure a Discovery Run",
    description:
      'Navigate to "New Discovery" in the sidebar. Enter your business name, select catalogs/schemas from your Unity Catalog, pick an industry and 2–3 business priorities, then choose a discovery depth.',
    icon: Settings2,
  },
  {
    step: 2,
    title: "Wait for the Pipeline",
    description:
      "The 7-step pipeline runs automatically: business context, metadata extraction, table filtering, use case generation, domain clustering, scoring, and SQL generation. Enable Estate Scan for deeper metadata analysis.",
    icon: Rocket,
  },
  {
    step: 3,
    title: "Review Use Cases",
    description:
      "Browse generated use cases on the run detail page. Filter by domain, type, or score. Edit titles and descriptions. Mark favourites. View the SQL and lineage behind each use case.",
    icon: Lightbulb,
  },
  {
    step: 4,
    title: "Export and Deploy",
    description:
      "Export to Excel, PDF, PowerPoint, CSV, or JSON. Deploy SQL notebooks directly to your workspace. Generate Genie Spaces and dashboards powered by your use cases.",
    icon: FileText,
  },
];

// ---------------------------------------------------------------------------
// Feature Guide
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    title: "Ask Forge",
    icon: BrainCircuit,
    badge: "AI",
    description:
      "A conversational AI assistant that answers questions about your data estate. Responses are grounded in your actual Unity Catalog metadata and enriched with RAG from estate scans, pipeline results, and uploaded documents.",
    details: [
      "Ask business or technical questions in natural language",
      "Answers cite specific sources with similarity scores",
      "SQL proposals use only real table and column names from your estate",
      "One-click actions: run SQL, deploy notebooks, create dashboards, launch Genie Spaces",
      "Conversation history is saved per user — resume previous chats anytime",
      "Context panel shows referenced tables with health, lineage, PII, and AI insights",
      "Open from anywhere with ⌘J (Mac) or Ctrl+J (Windows/Linux)",
    ],
  },
  {
    title: "Estate Intelligence",
    icon: Globe,
    badge: null,
    description:
      "A comprehensive view of your data estate combining discovery runs and standalone environment scans. Includes 8 LLM intelligence passes: domain classification, PII detection, redundancy analysis, relationship discovery, data tier assignment, data product identification, governance scoring, and table descriptions.",
    details: [
      "Summary tab: executive summary, data maturity score, scan trends over time",
      "Tables tab: browse all tables with domain, health score, PII flags, and AI insights",
      "ERD tab: interactive entity-relationship diagram with lineage edges",
      "Table Coverage: map estate tables to discovered use cases (covered vs untapped)",
      "Export a 12-sheet Excel report with full estate analysis",
      "Drill into any table for detailed health, columns, lineage, and recommendations",
      "Run standalone scans independently of discovery pipelines",
    ],
  },
  {
    title: "Genie Studio",
    icon: Sparkles,
    badge: null,
    description:
      "Create, manage, and continuously improve Databricks Genie Spaces. Includes Quick Build from Ask Forge, a full 7-pass engine, health scoring (A–F), benchmark testing, automated fix workflows, and AI Comments integration.",
    details: [
      "Quick Build: create a Genie Space from Ask Forge in seconds — scopes tables tightly to your question",
      "Full Engine: 7 LLM passes produce measures, filters, expressions, joins, benchmarks, and metric views (1–3 min)",
      "Health Scoring: every space gets an A–F grade across 4 categories (Data Sources, Instructions, Semantic Richness, Quality Assurance)",
      "Fix All: automated fix strategies enrich measures, filters, expressions, joins, and benchmarks in one click",
      "Benchmark Test Runner: run individual or batch tests against the Genie Conversation API with failure diagnostics (category, reason, SQL similarity)",
      "Improve with Engine: run the full engine on any existing space with live progress tracking and cancel support",
      "AI Comments link: health warnings about missing column descriptions link directly to the AI Comment tool",
      "Sorting and search across all your spaces by health score, fixable issues, or name",
      "Deploy, clone, trash, and open spaces directly in Databricks",
    ],
  },
  {
    title: "Knowledge Base",
    icon: BookOpen,
    badge: "RAG",
    description:
      "Upload documents that enrich Ask Forge's answers and discovery prompts. Strategy packs, data dictionaries, governance policies, and architecture docs are chunked, embedded, and stored for semantic retrieval.",
    details: [
      "Supports PDF, Markdown, and plain text (up to 20 MB per file)",
      "Assign a category: Strategy Pack, Data Dictionary, Governance Policy, Architecture Docs, or Other",
      "Drag-and-drop or file picker upload",
      "Documents are automatically chunked and embedded for RAG",
      "View chunk count and processing status per document",
      "Requires the embedding endpoint to be configured",
    ],
  },
  {
    title: "Outcome Maps",
    icon: Map,
    badge: null,
    description:
      "Industry-specific reference frameworks with KPIs, strategic priorities, and curated use cases. Selecting an industry during configuration enriches AI prompts for more relevant, domain-aligned recommendations.",
    details: [
      "Browse industries: Banking, Insurance, Healthcare, Retail, Manufacturing, and more",
      "Each industry includes objectives, strategic priorities, reference use cases, KPIs, and personas",
      "Search across industries, priorities, or use cases",
      "Start a discovery run pre-filled with industry context",
      "Ingest custom industry outcome maps",
    ],
  },
  {
    title: "Compare Runs",
    icon: GitCompare,
    badge: null,
    description:
      "Side-by-side comparison of two completed discovery runs, useful for A/B testing configurations, validating prompt improvements, and tracking quality over time.",
    details: [
      "Metric comparison: use case counts, average scores, domains, token usage, duration",
      "Step-level comparison: duration, tokens, LLM calls, and success rates per pipeline step",
      "Prompt version diffs: see exactly what changed between template versions",
      "Use case overlap: unique to each run vs shared",
      "Semantic overlap: embedding-based similarity analysis",
      "Configuration differences at a glance",
      "Export comparison to Excel",
    ],
  },
  {
    title: "Dashboards",
    icon: LayoutDashboard,
    badge: null,
    description:
      "Generate and deploy AI/BI dashboards powered by your discovered use cases. Ask Forge can also propose dashboards from conversational queries.",
    details: [
      "Dashboard engine generates recommendations per domain",
      "Preview dashboard proposals before deploying",
      "Deploy creates dashboards in your Databricks workspace",
      "Ask Forge detects dashboard intent and proposes SQL-backed visualisations",
    ],
  },
];

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQ = [
  {
    question: "What data does Forge access?",
    answer:
      "Forge reads only metadata (table names, column names, data types, foreign keys) from your Unity Catalog information_schema. No row-level data is accessed unless you enable data sampling in Settings, which reads a small number of sample rows for column profiling. Sampled data is not persisted.",
  },
  {
    question: "What happens if the pipeline fails?",
    answer:
      'If a pipeline fails mid-run, you can click "Resume Pipeline" on the run detail page to restart from the last successful step. All previously completed steps are preserved.',
  },
  {
    question: "What is an Estate Scan?",
    answer:
      "An estate scan runs 8 LLM intelligence passes over your metadata: domain classification, PII detection, redundancy analysis, relationship discovery, data tier assignment, data product identification, governance scoring, and table descriptions. Results appear on the Estate page. You can run scans standalone or as part of a discovery pipeline.",
  },
  {
    question: "What are Genie Spaces?",
    answer:
      "Genie Spaces are Databricks workspaces where business users can ask natural language questions that get translated into SQL. Forge generates pre-configured Genie Spaces with semantic expressions, filters, benchmark queries, and metric views based on your metadata and use cases.",
  },
  {
    question: "How does Genie health scoring work?",
    answer:
      "Every Genie Space is graded A–F based on ~40 checks across 4 categories: Data Sources (column configs, descriptions), Instructions (joins, example SQL, text instructions), Semantic Richness (measures, filters, expressions with display names, comments, and synonyms), and Quality Assurance (benchmarks, SQL quality). The engine now populates all these fields automatically, so engine-generated spaces typically score A or B.",
  },
  {
    question: "What is the difference between Quick Build and Full Engine?",
    answer:
      "Quick Build creates a usable Genie Space in seconds using rule-based passes with fast LLM refinements — great for getting started. Full Engine runs all 7 LLM passes (column intelligence, semantic expressions, join inference, trusted assets, instructions, benchmarks, metric views) and takes 1–3 minutes but produces production-grade output with higher health scores.",
  },
  {
    question: "How do I improve an existing Genie Space?",
    answer:
      "Open any space in Genie Studio and use 'Improve with Engine' to run the full 7-pass engine against it. You can also use 'Fix All' to target specific failing health checks, or run benchmarks and use the feedback loop to iteratively improve accuracy. Progress is tracked with a banner visible across all tabs.",
  },
  {
    question: "What are Industry Outcome Maps?",
    answer:
      "Outcome maps are curated reference frameworks for specific industries (e.g., Financial Services, Healthcare, Retail). They define KPIs, strategic use cases, personas, and domain priorities. When selected during configuration, they enrich the LLM prompts for more targeted, industry-aligned recommendations.",
  },
  {
    question: "How does scoring work?",
    answer:
      "Each use case is scored on 4 dimensions: Feasibility (how implementable), Business Value (potential impact), Innovation (novelty), and Data Readiness (metadata quality). The composite score is a weighted average. Business priorities boost aligned use case scores. Scores are then calibrated and deduplicated.",
  },
  {
    question: "What is the Knowledge Base?",
    answer:
      "The Knowledge Base lets you upload documents (PDFs, Markdown, text files) that are chunked and embedded for semantic retrieval. These documents enrich Ask Forge answers and provide additional context for discovery prompts. Examples include strategy decks, data dictionaries, and governance policies.",
  },
  {
    question: "How does Ask Forge work?",
    answer:
      "Ask Forge uses a dual-strategy RAG pipeline: direct Lakebase queries for structured context (business context, estate summary, deployed assets) plus pgvector semantic search across 12 embedding kinds. The LLM receives grounded context and generates responses citing specific sources. All SQL proposals use only real table and column names from your estate.",
  },
  {
    question: "Can I compare multiple runs?",
    answer:
      'Yes. Navigate to "Compare" in the sidebar, select two completed runs, and view side-by-side metrics, use case overlap, semantic similarity, configuration differences, prompt diffs, and step-level timing. You can export the comparison to Excel.',
  },
  {
    question: "Where are my settings saved?",
    answer:
      "Application settings (discovery depth, Genie defaults, export preferences) are stored in your browser's localStorage. They persist across sessions but are local to your browser. Pipeline runs, use cases, scans, conversations, and exports are stored in Lakebase (server-side).",
  },
  {
    question: "What embedding endpoint do I need?",
    answer:
      "Forge uses the databricks-qwen3-embedding-0-6b model (1024-dimensional vectors) via a Model Serving endpoint. Configure the endpoint name in Settings under Semantic Search & RAG. When enabled, it powers Ask Forge's RAG, Knowledge Base, semantic search in the Estate tab, and run comparison overlap analysis.",
  },
  {
    question: "Is my data sent outside my workspace?",
    answer:
      "No. All LLM calls go through your workspace's Model Serving endpoints. All data stays within your Databricks environment. Authentication is handled automatically by the Databricks Apps platform.",
  },
];

// ---------------------------------------------------------------------------
// Tips
// ---------------------------------------------------------------------------

const TIPS = [
  "Start with Focused depth for your first run to get a quick feel for the tool, then switch to Balanced or Comprehensive for deeper analysis.",
  "Selecting an industry outcome map pre-loads curated KPIs and strategic context, significantly improving use case relevance.",
  "Use the Catalog Browser to precisely scope your metadata. Scanning fewer schemas produces more focused, higher-quality results.",
  "Enable Estate Scan on your first run for a comprehensive view of data health, governance, and lineage across your estate.",
  "Upload strategy decks and data dictionaries to the Knowledge Base — Ask Forge uses them to give more contextual answers.",
  "Use ⌘J (Mac) or Ctrl+J to quickly toggle Ask Forge from anywhere in the app.",
  "The Compare page is great for A/B testing different configurations or validating prompt improvements across runs.",
  "Export as Executive Briefing (PPTX) for stakeholder presentations — it combines estate intelligence with use case findings.",
  "Ask Forge can propose SQL, deploy notebooks, create dashboards, and launch Genie Spaces — all from a single question.",
  "Review the context panel in Ask Forge to see which tables, sources, and enrichments informed each answer.",
  "Run AI Comments before creating Genie Spaces — column descriptions dramatically improve health scores and Genie query accuracy.",
  "Use the benchmark Test Runner to validate Genie Spaces — run all tests, review failure categories, and iterate with Fix All.",
  "After Quick Build, use 'Enhance with Full Engine' to add measures, filters, expressions, joins, and benchmarks for a production-grade space.",
  "Sort Genie Spaces by health score to quickly find which spaces need the most attention.",
  "The Genie Engine progress banner stays visible even if you switch tabs — no need to wait on the page.",
];

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { keys: "⌘J / Ctrl+J", description: "Toggle Ask Forge from anywhere" },
  { keys: "Enter", description: "Send message in Ask Forge" },
  { keys: "Shift+Enter", description: "New line in Ask Forge input" },
  { keys: "Esc", description: "Close modals and dialogs" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader title="Help" subtitle="Learn how to get the most from Forge." />

      {/* Quick Start */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Quick Start
          </CardTitle>
          <CardDescription>Get from zero to actionable use cases in four steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {QUICK_START.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="flex gap-3 rounded-lg border p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      <Badge variant="secondary" className="mr-2 text-[10px]">
                        Step {item.step}
                      </Badge>
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Feature Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Feature Guide
          </CardTitle>
          <CardDescription>Everything Forge can do — click to expand each feature.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <Collapsible key={i}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors text-left">
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    {feature.title}
                    {feature.badge && (
                      <Badge variant="secondary" className="text-[10px]">
                        {feature.badge}
                      </Badge>
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-4">
                    <p className="mb-3 text-sm text-muted-foreground">{feature.description}</p>
                    <ul className="space-y-1.5">
                      {feature.details.map((detail, j) => (
                        <li key={j} className="flex gap-2 text-xs text-muted-foreground">
                          <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {SHORTCUTS.map((s, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <kbd className="inline-flex items-center rounded border bg-muted px-2 py-0.5 text-[11px] font-mono font-medium text-muted-foreground">
                  {s.keys}
                </kbd>
                <span className="text-sm text-muted-foreground">{s.description}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Tips and Best Practices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {TIPS.map((tip, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span className="text-muted-foreground">{tip}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Frequently Asked Questions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {FAQ.map((item, i) => (
            <Collapsible key={i}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors text-left">
                {item.question}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="px-3 pb-3 text-sm text-muted-foreground">{item.answer}</p>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      {/* Pipeline Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Discovery Pipeline Steps
          </CardTitle>
          <CardDescription>The discovery pipeline runs these 8 steps sequentially.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                step: 1,
                name: "Business Context",
                desc: "Generates industry context, value chain, and revenue model from your business name and selected industry.",
              },
              {
                step: 2,
                name: "Metadata Extraction",
                desc: "Queries information_schema to discover tables, columns, and foreign keys across selected catalogs/schemas.",
              },
              {
                step: 3,
                name: "Table Filtering",
                desc: "Classifies each table as business-relevant or technical/system using the fast LLM model.",
              },
              {
                step: 4,
                name: "Use Case Generation",
                desc: "Generates use cases in parallel batches, grounded in your metadata and business context.",
              },
              {
                step: 5,
                name: "Domain Clustering",
                desc: "Assigns business domains and subdomains to each use case for organised browsing.",
              },
              {
                step: 6,
                name: "Scoring and Dedup",
                desc: "Scores on 4 dimensions (Feasibility, Business Value, Innovation, Data Readiness), deduplicates, and calibrates.",
              },
              {
                step: 7,
                name: "SQL Generation",
                desc: "Generates bespoke SQL for each use case, validated against real table schemas.",
              },
              {
                step: 8,
                name: "Business Value Analysis",
                desc: "Financial quantification, roadmap phasing, executive synthesis, and stakeholder analysis for each use case.",
              },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary/30 text-[10px] font-bold text-primary">
                  {s.step}
                </div>
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Privacy Note */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Privacy and Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Forge reads only metadata (table and column names, data types, foreign keys) from your
            Unity Catalog. No row-level data is accessed unless data sampling is explicitly enabled
            in Settings — sampled data is sent to the LLM but never persisted.
          </p>
          <p className="text-sm text-muted-foreground">
            All LLM calls go through your workspace&apos;s Model Serving endpoints — no data leaves
            your Databricks environment. Authentication is handled automatically by the Databricks
            Apps platform. Conversation history and pipeline results are stored in Lakebase within
            your workspace.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
