import type {
  BoardMode,
  CandidateEntry,
  CandidateEntryReviewStatus,
  CandidateFreshness,
  CandidatePack,
  CandidateSpoilerRisk,
  RejectedCandidateExample,
  SavedWordPack
} from "@acg-codenames/shared";

export type ImportedWordPackFile =
  | {
      kind: "playable";
      pack: { name: string; description?: string; entries: string[] };
    }
  | {
      kind: "candidate";
      pack: CandidatePack;
    };

export interface CandidateEntryIssue {
  level: "warning" | "error";
  code:
    | "duplicate-display"
    | "long-display"
    | "alias-conflict"
    | "invalid-difficulty"
    | "invalid-uniqueness"
    | "invalid-playability"
    | "weak-unknown-franchise"
    | "high-spoiler"
    | "low-playability"
    | "low-uniqueness";
  message: string;
}

export interface CandidateExportFilters {
  allowedDifficultyRange: [number, number];
  allowedSpoilerRisks: CandidateSpoilerRisk[];
  allowedFreshness: CandidateFreshness[];
  allowedTypes: string[];
  franchiseQuota: number;
}

export const defaultExportFilters: CandidateExportFilters = {
  allowedDifficultyRange: [1, 5],
  allowedSpoilerRisks: ["low", "medium"],
  allowedFreshness: ["stable", "seasonal", "unknown"],
  allowedTypes: [],
  franchiseQuota: 0
};

function normalizeKey(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function normalizeTextArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

function isBoardMode(value: string): value is BoardMode {
  return value === "5x5" || value === "7x7" || value === "9x9";
}

function normalizeCandidateEntry(raw: Record<string, unknown>): CandidateEntry {
  return {
    display: String(raw.display ?? "").trim(),
    aliases: normalizeTextArray(raw.aliases),
    type: String(raw.type ?? "其他").trim() || "其他",
    franchise: String(raw.franchise ?? "unknown").trim() || "unknown",
    tags: normalizeTextArray(raw.tags),
    difficulty: Number(raw.difficulty ?? 3),
    uniquenessScore: Number(raw.uniquenessScore ?? 5),
    playabilityScore: Number(raw.playabilityScore ?? 5),
    spoilerRisk: (["low", "medium", "high"].includes(String(raw.spoilerRisk)) ? raw.spoilerRisk : "low") as CandidateSpoilerRisk,
    freshness: (["stable", "seasonal", "volatile", "unknown"].includes(String(raw.freshness)) ? raw.freshness : "stable") as CandidateFreshness,
    reason: String(raw.reason ?? "").trim(),
    reviewStatus: (["pending", "approved", "rejected"].includes(String(raw.reviewStatus)) ? raw.reviewStatus : "pending") as CandidateEntryReviewStatus,
    reviewNotes: String(raw.reviewNotes ?? "").trim() || undefined
  };
}

export function parseImportedWordPackText(content: string, fallbackName: string): ImportedWordPackFile {
  const parsed = JSON.parse(content) as unknown;

  if (Array.isArray(parsed)) {
    return {
      kind: "playable",
      pack: {
        name: fallbackName,
        entries: parsed.map(String).map((entry) => entry.trim()).filter(Boolean)
      }
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("题库文件格式无效");
  }

  const object = parsed as Record<string, unknown>;

  if (Array.isArray(object.entries) && object.entries.every((entry) => typeof entry === "string")) {
    return {
      kind: "playable",
      pack: {
        name: String(object.name ?? object.packName ?? fallbackName).trim() || fallbackName,
        description: String(object.description ?? object.summary ?? "").trim() || undefined,
        entries: (object.entries as string[]).map((entry) => entry.trim()).filter(Boolean)
      }
    };
  }

  if (Array.isArray(object.entries)) {
    const recommendedBoardModes = Array.isArray(object.recommendedBoardModes)
      ? object.recommendedBoardModes.map(String).filter(isBoardMode)
      : [];
    const rejectedExamples = Array.isArray(object.rejectedExamples)
      ? object.rejectedExamples
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map(
            (item): RejectedCandidateExample => ({
              text: String(item.text ?? "").trim(),
              reason: String(item.reason ?? "").trim()
            })
          )
      : [];

    return {
      kind: "candidate",
      pack: {
        packName: String(object.packName ?? object.name ?? fallbackName).trim() || fallbackName,
        summary: String(object.summary ?? object.description ?? "").trim(),
        recommendedBoardModes,
        entries: object.entries
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
          .map(normalizeCandidateEntry),
        rejectedExamples,
        sourceMeta:
          object.sourceMeta && typeof object.sourceMeta === "object"
            ? {
                generatedBy: String((object.sourceMeta as Record<string, unknown>).generatedBy ?? "").trim() || undefined,
                sourceMaterial: String((object.sourceMeta as Record<string, unknown>).sourceMaterial ?? "").trim() || undefined,
                createdAt: String((object.sourceMeta as Record<string, unknown>).createdAt ?? "").trim() || undefined,
                version: String((object.sourceMeta as Record<string, unknown>).version ?? "").trim() || undefined
              }
            : undefined
      }
    };
  }

  throw new Error("题库文件缺少可识别的 entries 字段");
}

export function getCandidateEntryIssues(entry: CandidateEntry, allEntries: CandidateEntry[]): CandidateEntryIssue[] {
  const issues: CandidateEntryIssue[] = [];
  const displayKey = normalizeKey(entry.display);
  const aliasKeys = entry.aliases.map(normalizeKey);
  const otherEntries = allEntries.filter((candidate) => candidate !== entry);
  const allOtherDisplayKeys = new Set(otherEntries.map((candidate) => normalizeKey(candidate.display)));
  const allOtherAliasKeys = new Set(otherEntries.flatMap((candidate) => candidate.aliases.map(normalizeKey)));

  if (!entry.display) {
    issues.push({ level: "error", code: "duplicate-display", message: "缺少 display，无法导出。" });
  }
  if (entry.display.length > 14) {
    issues.push({ level: "warning", code: "long-display", message: "display 过长，棋盘上可能难读。" });
  }
  if (allOtherDisplayKeys.has(displayKey)) {
    issues.push({ level: "error", code: "duplicate-display", message: "display 与其他候选词重复。" });
  }
  if (aliasKeys.some((key) => key === displayKey || allOtherDisplayKeys.has(key) || allOtherAliasKeys.has(key))) {
    issues.push({ level: "warning", code: "alias-conflict", message: "aliases 与现有 display 或 aliases 存在概念冲突。" });
  }
  if (entry.difficulty < 1 || entry.difficulty > 5) {
    issues.push({ level: "error", code: "invalid-difficulty", message: "difficulty 应在 1 到 5 之间。" });
  }
  if (entry.uniquenessScore < 1 || entry.uniquenessScore > 10) {
    issues.push({ level: "error", code: "invalid-uniqueness", message: "uniquenessScore 应在 1 到 10 之间。" });
  }
  if (entry.playabilityScore < 1 || entry.playabilityScore > 10) {
    issues.push({ level: "error", code: "invalid-playability", message: "playabilityScore 应在 1 到 10 之间。" });
  }
  if (entry.franchise === "unknown" && entry.reason.length < 8) {
    issues.push({ level: "warning", code: "weak-unknown-franchise", message: "franchise=unknown 且 reason 偏弱，建议人工复核。" });
  }
  if (entry.spoilerRisk === "high") {
    issues.push({ level: "warning", code: "high-spoiler", message: "高剧透风险，默认不建议进普通包。" });
  }
  if (entry.playabilityScore <= 3) {
    issues.push({ level: "warning", code: "low-playability", message: "可玩性偏低，默认建议拒绝。" });
  }
  if (entry.uniquenessScore <= 3) {
    issues.push({ level: "warning", code: "low-uniqueness", message: "辨识度偏低，默认建议拒绝。" });
  }

  return issues;
}

export function collectCandidateTaxonomy(pack: CandidatePack): { types: string[]; franchises: string[] } {
  return {
    types: Array.from(new Set(pack.entries.map((entry) => entry.type))).sort((left, right) => left.localeCompare(right)),
    franchises: Array.from(new Set(pack.entries.map((entry) => entry.franchise))).sort((left, right) => left.localeCompare(right))
  };
}

export function exportPlayablePack(candidatePack: CandidatePack, filters: CandidateExportFilters): SavedWordPack {
  const selected = candidatePack.entries.filter((entry) => {
    if (entry.reviewStatus !== "approved") {
      return false;
    }
    if (entry.difficulty < filters.allowedDifficultyRange[0] || entry.difficulty > filters.allowedDifficultyRange[1]) {
      return false;
    }
    if (!filters.allowedSpoilerRisks.includes(entry.spoilerRisk)) {
      return false;
    }
    if (!filters.allowedFreshness.includes(entry.freshness)) {
      return false;
    }
    if (filters.allowedTypes.length > 0 && !filters.allowedTypes.includes(entry.type)) {
      return false;
    }
    return true;
  });

  const usedKeys = new Set<string>();
  const franchiseCounts = new Map<string, number>();
  const entries: string[] = [];

  for (const entry of selected) {
    const displayKey = normalizeKey(entry.display);
    const aliasKeys = entry.aliases.map(normalizeKey);
    if (usedKeys.has(displayKey) || aliasKeys.some((key) => usedKeys.has(key))) {
      continue;
    }
    const franchise = entry.franchise || "unknown";
    const currentCount = franchiseCounts.get(franchise) ?? 0;
    if (filters.franchiseQuota > 0 && currentCount >= filters.franchiseQuota) {
      continue;
    }

    entries.push(entry.display.trim());
    usedKeys.add(displayKey);
    aliasKeys.forEach((key) => usedKeys.add(key));
    franchiseCounts.set(franchise, currentCount + 1);
  }

  if (entries.length === 0) {
    throw new Error("没有符合导出条件的已通过词条。");
  }

  const approved = selected.filter((entry) => entries.includes(entry.display.trim()));
  const difficultyValues = approved.map((entry) => entry.difficulty);
  const sourceFranchises = Array.from(new Set(approved.map((entry) => entry.franchise).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

  const timestamp = Date.now();
  return {
    id: `pack-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: candidatePack.packName.trim() || "候选题库导出",
    description: candidatePack.summary.trim() || undefined,
    entries,
    sourceFranchises,
    difficultyRange: difficultyValues.length > 0 ? [Math.min(...difficultyValues), Math.max(...difficultyValues)] : undefined,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
