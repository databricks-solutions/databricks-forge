"use client";

import { useState, useEffect } from "react";
import {
  loadSettings,
  DEFAULT_CATALOG_RESOURCE_PREFIX,
  DEFAULT_COMMENT_OUTPUT_LANGUAGE,
} from "@/lib/settings";
import {
  DEFAULT_DEPTH_CONFIGS,
  type DiscoveryDepth,
  type DiscoveryDepthConfig,
} from "@/lib/domain/types";
import type {
  GenieEngineDefaults,
  GenieAuthMode,
  QuestionComplexitySettings,
  CommentOutputLanguage,
} from "@/lib/settings";

export function useSettingsState() {
  const [sampleRowsPerTable, setSampleRowsPerTable] = useState(() => {
    if (typeof window === "undefined") return 0;
    return loadSettings().sampleRowsPerTable;
  });
  const [defaultExportFormat, setDefaultExportFormat] = useState(() => {
    if (typeof window === "undefined") return "excel";
    return loadSettings().defaultExportFormat ?? "excel";
  });
  const [notebookPath, setNotebookPath] = useState(() => {
    if (typeof window === "undefined") return "./forge_gen/";
    return loadSettings().notebookPath ?? "./forge_gen/";
  });
  const [defaultDiscoveryDepth, setDefaultDiscoveryDepth] = useState<DiscoveryDepth>(() => {
    if (typeof window === "undefined") return "balanced";
    return loadSettings().defaultDiscoveryDepth ?? "balanced";
  });
  const [depthConfigs, setDepthConfigs] = useState<Record<DiscoveryDepth, DiscoveryDepthConfig>>(
    () => {
      if (typeof window === "undefined") return { ...DEFAULT_DEPTH_CONFIGS };
      return loadSettings().discoveryDepthConfigs;
    },
  );
  const [genieDefaults, setGenieDefaults] = useState<GenieEngineDefaults>(() => {
    if (typeof window === "undefined") {
      return {
        engineEnabled: true,
        maxTablesPerSpace: 25,
        maxAutoSpaces: 0,
        llmRefinement: true,
        generateBenchmarks: true,
        generateMetricViews: true,
        autoTimePeriods: true,
        generateTrustedAssets: true,
        fiscalYearStartMonth: 1,
        entityMatchingMode: "auto",
        qualityPreset: "balanced",
      };
    }
    return loadSettings().genieEngineDefaults;
  });
  const [estateScanEnabled, setEstateScanEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadSettings().estateScanEnabled;
  });
  const [assetDiscoveryEnabled, setAssetDiscoveryEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadSettings().assetDiscoveryEnabled;
  });
  const [genieDeployAuthMode, setGenieDeployAuthMode] = useState<GenieAuthMode>(() => {
    if (typeof window === "undefined") return "obo";
    return loadSettings().genieDeployAuthMode;
  });
  const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return loadSettings().semanticSearchEnabled;
  });
  const [benchmarksEnabled, setBenchmarksEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadSettings().benchmarksEnabled;
  });
  const [questionComplexity, setQuestionComplexity] = useState<QuestionComplexitySettings>(() => {
    if (typeof window === "undefined") {
      return { genieEngine: "simple", adhocGenie: "simple", metadataGenie: "simple" };
    }
    return loadSettings().questionComplexity;
  });
  const [catalogResourcePrefix, setCatalogResourcePrefix] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_CATALOG_RESOURCE_PREFIX;
    return loadSettings().catalogResourcePrefix;
  });
  const [industry, setIndustry] = useState(() => {
    if (typeof window === "undefined") return "";
    return loadSettings().industry;
  });
  const [aiCommentLanguage, setAiCommentLanguage] = useState<CommentOutputLanguage>(() => {
    if (typeof window === "undefined") return DEFAULT_COMMENT_OUTPUT_LANGUAGE;
    return loadSettings().aiCommentLanguage;
  });
  const [benchmarksServerEnabled, setBenchmarksServerEnabled] = useState<boolean | null>(null);
  const [metricViewsServerEnabled, setMetricViewsServerEnabled] = useState<boolean | null>(null);
  const [demoModeEnabled, setDemoModeEnabled] = useState<boolean | null>(null);
  const [embeddingAvailable, setEmbeddingAvailable] = useState<boolean | null>(null);
  const [rebuildingEmbeddings, setRebuildingEmbeddings] = useState(false);
  const [embeddingCount, setEmbeddingCount] = useState<number | null>(null);
  const [profile, setProfile] = useState<{ email: string | null; host: string | null } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/benchmarks/status")
      .then((r) => r.json())
      .then((data) => setBenchmarksServerEnabled(data.enabled ?? false))
      .catch(() => setBenchmarksServerEnabled(false));
  }, []);

  useEffect(() => {
    fetch("/api/embeddings/status")
      .then((r) => r.json())
      .then((data) => {
        setEmbeddingAvailable(data.enabled ?? false);
        if (typeof data.totalRecords === "number") setEmbeddingCount(data.totalRecords);
      })
      .catch(() => setEmbeddingAvailable(false));
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        setProfile({ email: data.userEmail ?? null, host: data.host ?? null });
        setMetricViewsServerEnabled(data.metricViewsEnabled ?? false);
        setDemoModeEnabled(data.demoModeEnabled ?? false);
      })
      .catch(() => {
        setProfile({ email: null, host: null });
        setMetricViewsServerEnabled(false);
        setDemoModeEnabled(false);
      });
  }, []);

  const updateDepthParam = (
    depth: DiscoveryDepth,
    key: keyof DiscoveryDepthConfig,
    value: number,
  ) => {
    setDepthConfigs((prev) => ({ ...prev, [depth]: { ...prev[depth], [key]: value } }));
  };

  return {
    sampleRowsPerTable,
    setSampleRowsPerTable,
    defaultExportFormat,
    setDefaultExportFormat,
    notebookPath,
    setNotebookPath,
    defaultDiscoveryDepth,
    setDefaultDiscoveryDepth,
    depthConfigs,
    setDepthConfigs,
    genieDefaults,
    setGenieDefaults,
    estateScanEnabled,
    setEstateScanEnabled,
    assetDiscoveryEnabled,
    setAssetDiscoveryEnabled,
    genieDeployAuthMode,
    setGenieDeployAuthMode,
    semanticSearchEnabled,
    setSemanticSearchEnabled,
    benchmarksEnabled,
    setBenchmarksEnabled,
    questionComplexity,
    setQuestionComplexity,
    catalogResourcePrefix,
    setCatalogResourcePrefix,
    industry,
    setIndustry,
    aiCommentLanguage,
    setAiCommentLanguage,
    benchmarksServerEnabled,
    metricViewsServerEnabled,
    demoModeEnabled,
    embeddingAvailable,
    rebuildingEmbeddings,
    setRebuildingEmbeddings,
    embeddingCount,
    setEmbeddingCount,
    profile,
    deleting,
    setDeleting,
    updateDepthParam,
  };
}
