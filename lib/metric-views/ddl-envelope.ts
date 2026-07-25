import { validateFqn } from "@/lib/validation";

const DDL_IDENTIFIER = "(?:`[^`]+`|[a-zA-Z0-9_-]+)";
const METRIC_VIEW_DDL_HEADER_RE = new RegExp(
  `^\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(${DDL_IDENTIFIER}\\.${DDL_IDENTIFIER}\\.${DDL_IDENTIFIER})\\s+WITH\\s+METRICS\\s+LANGUAGE\\s+YAML\\s+AS\\s+\\$\\$`,
  "i",
);

export interface MetricViewDdlEnvelope {
  targetFqn: string;
  targetStart: number;
  targetEnd: number;
  bodyStart: number;
  closingDelimiterOffset: number;
}

export function parseMetricViewDdlEnvelope(ddl: string): MetricViewDdlEnvelope {
  const header = METRIC_VIEW_DDL_HEADER_RE.exec(ddl);
  if (!header) {
    throw new Error("Metric view DDL envelope is malformed");
  }

  const closingDelimiterOffset = ddl.indexOf("$$", header[0].length);
  if (
    closingDelimiterOffset === -1 ||
    !/^\s*;?\s*$/.test(ddl.slice(closingDelimiterOffset + 2))
  ) {
    throw new Error("Metric view DDL envelope is malformed");
  }

  const targetFqn = validateFqn(header[1], "metric view");
  if (targetFqn.split(".").length !== 3) {
    throw new Error("Metric view DDL envelope is malformed");
  }
  const targetStart = header.index + header[0].indexOf(header[1]);

  return {
    targetFqn,
    targetStart,
    targetEnd: targetStart + header[1].length,
    bodyStart: header.index + header[0].length,
    closingDelimiterOffset,
  };
}

export function replaceMetricViewDdlYaml(ddl: string, yaml: string): string {
  if (yaml.includes("$$")) {
    throw new Error("Metric view YAML contains the reserved outer DDL delimiter ($$).");
  }
  const envelope = parseMetricViewDdlEnvelope(ddl);
  return (
    ddl.slice(0, envelope.bodyStart) +
    `\n${yaml}` +
    ddl.slice(envelope.closingDelimiterOffset)
  );
}
