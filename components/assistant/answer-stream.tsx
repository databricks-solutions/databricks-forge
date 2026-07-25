"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Copy, Check, Play } from "lucide-react";

interface AnswerStreamProps {
  content: string;
  isStreaming: boolean;
  isPreparing?: boolean;
  onRunSql?: (sql: string) => void;
}

const CITATION_RE = /\[(\d+)\]/g;

function injectCitations(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <sup key={match.index} className="text-primary font-bold text-[10px]">
        [{match[1]}]
      </sup>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (typeof node === "object" && "props" in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return extractTextContent(el.props.children);
  }
  return "";
}

function CodeBlock({
  children,
  isSql,
  onRunSql,
}: {
  children: React.ReactNode;
  isSql: boolean;
  onRunSql?: (sql: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = extractTextContent(children);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRunSql?.(text);
  };

  return (
    <div className="group/code relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/code:opacity-100">
        {isSql && onRunSql && (
          <button
            type="button"
            onClick={handleRun}
            className="flex h-6 items-center gap-1 rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          >
            <Play className="size-3" />
            Run
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-6 items-center gap-1 rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const REMARK_PLUGINS = [remarkGfm];

export function AnswerStream({ content, isStreaming, isPreparing, onRunSql }: AnswerStreamProps) {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [content]);

  const components = React.useMemo<Components>(
    () => ({
      p({ children }) {
        if (typeof children === "string") {
          return <p>{injectCitations(children)}</p>;
        }
        return <p>{children}</p>;
      },
      li({ children }) {
        if (typeof children === "string") {
          return <li>{injectCitations(children)}</li>;
        }
        return <li>{children}</li>;
      },
      pre({ children }) {
        const codeChild = React.Children.toArray(children).find(
          (child): child is React.ReactElement =>
            React.isValidElement(child) && (child as React.ReactElement).type === "code",
        ) as React.ReactElement | undefined;
        const className = (codeChild?.props as { className?: string })?.className ?? "";
        const isSql = /language-sql/i.test(className);
        return (
          <CodeBlock isSql={isSql} onRunSql={onRunSql}>
            {children}
          </CodeBlock>
        );
      },
    }),
    [onRunSql],
  );

  if (!content && !isStreaming) return null;

  return (
    <div className="relative">
      <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-relaxed [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/60 [&_pre]:p-4 [&_pre]:text-xs [&_pre]:text-foreground [&_code]:rounded [&_code]:border [&_code]:border-border/50 [&_code]:bg-muted/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-foreground [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:text-xs [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_td]:border-border [&_td]:px-2 [&_td]:py-1">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
          {content}
        </ReactMarkdown>
      </div>
      {isStreaming && !isPreparing && (
        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-primary" />
      )}
      {isPreparing && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex gap-0.5">
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]" />
          </span>
          Preparing actions&hellip;
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
