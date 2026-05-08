import { useMemo, useState } from "react";
import type { CandidateEntry, CandidatePack, CandidateSpoilerRisk } from "@acg-codenames/shared";
import {
  collectCandidateTaxonomy,
  defaultExportFilters,
  getCandidateEntryIssues,
  type CandidateEntryIssue,
  type CandidateExportFilters
} from "./word-pack-review";

interface CandidateReviewProps {
  pack: CandidatePack;
  onClose: () => void;
  onUpdateEntry: (display: string, patch: Partial<CandidateEntry>) => void;
  onBulkSetVisible: (displays: string[], reviewStatus: CandidateEntry["reviewStatus"]) => void;
  onExport: (filters: CandidateExportFilters) => void;
}

export function CandidateReview({ pack, onClose, onUpdateEntry, onBulkSetVisible, onExport }: CandidateReviewProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [franchiseFilter, setFranchiseFilter] = useState("");
  const [spoilerFilter, setSpoilerFilter] = useState<"" | CandidateSpoilerRisk>("");
  const [exportFilters, setExportFilters] = useState<CandidateExportFilters>(() => ({
    ...defaultExportFilters,
    allowedTypes: collectCandidateTaxonomy(pack).types
  }));

  const taxonomy = useMemo(() => collectCandidateTaxonomy(pack), [pack]);

  const visibleEntries = useMemo(() => {
    return pack.entries.filter((entry) => {
      const matchesSearch =
        !search ||
        entry.display.toLowerCase().includes(search.toLowerCase()) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(search.toLowerCase())) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      const matchesType = !typeFilter || entry.type === typeFilter;
      const matchesFranchise = !franchiseFilter || entry.franchise === franchiseFilter;
      const matchesSpoiler = !spoilerFilter || entry.spoilerRisk === spoilerFilter;
      return matchesSearch && matchesType && matchesFranchise && matchesSpoiler;
    });
  }, [pack, search, typeFilter, franchiseFilter, spoilerFilter]);

  const stats = useMemo(() => {
    const total = pack.entries.length;
    const approved = pack.entries.filter((e) => e.reviewStatus === "approved").length;
    const rejected = pack.entries.filter((e) => e.reviewStatus === "rejected").length;
    const pending = pack.entries.filter((e) => e.reviewStatus === "pending").length;
    const withErrors = pack.entries.filter((e) => getCandidateEntryIssues(e, pack.entries).some((i) => i.level === "error")).length;
    return { total, approved, rejected, pending, withErrors };
  }, [pack]);

  const handleBulkApprove = () => onBulkSetVisible(visibleEntries.map((e) => e.display), "approved");
  const handleBulkReject = () => onBulkSetVisible(visibleEntries.map((e) => e.display), "rejected");
  const handleBulkReset = () => onBulkSetVisible(visibleEntries.map((e) => e.display), "pending");

  return (
    <section className="candidate-review-page">
      <div className="candidate-review-hero">
        <div className="candidate-review-hero-main">
          <button className="back-button" onClick={onClose}>← 返回首页</button>
          <div>
            <p className="micro-label">Candidate Review</p>
            <h1>{pack.packName}</h1>
          </div>
          <p className="panel-subtle">{pack.summary || "候选题库审核后可导出为当前游戏可用的轻量题库。"}</p>
          <div className="chip-wrap">
            <span className="soft-chip">总计 {stats.total} 条</span>
            <span className="soft-chip review-approved">已通过 {stats.approved}</span>
            <span className="soft-chip review-rejected">已拒绝 {stats.rejected}</span>
            <span className="soft-chip review-pending">待审核 {stats.pending}</span>
            {stats.withErrors > 0 ? <span className="soft-chip issue-error">含错误 {stats.withErrors}</span> : null}
          </div>
          {pack.recommendedBoardModes.length > 0 ? (
            <div className="chip-wrap">
              <span className="soft-chip">推荐棋盘: </span>
              {pack.recommendedBoardModes.map((mode) => (
                <span className="soft-chip" key={mode}>{mode}</span>
              ))}
            </div>
          ) : null}
          {pack.sourceMeta ? (
            <div className="chip-wrap">
              {pack.sourceMeta.generatedBy ? <span className="soft-chip">生成: {pack.sourceMeta.generatedBy}</span> : null}
              {pack.sourceMeta.version ? <span className="soft-chip">版本: {pack.sourceMeta.version}</span> : null}
              {pack.sourceMeta.createdAt ? <span className="soft-chip">时间: {pack.sourceMeta.createdAt}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="candidate-review-body">
        <div className="candidate-review-tools">
          <div className="candidate-toolbar">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 display / aliases / tags" />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">所有类型</option>
              {taxonomy.types.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <select value={franchiseFilter} onChange={(event) => setFranchiseFilter(event.target.value)}>
              <option value="">所有作品</option>
              {taxonomy.franchises.map((franchise) => (
                <option key={franchise} value={franchise}>{franchise}</option>
              ))}
            </select>
            <select value={spoilerFilter} onChange={(event) => setSpoilerFilter(event.target.value as "" | CandidateSpoilerRisk)}>
              <option value="">全部剧透等级</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>

          <div className="candidate-batch-actions">
            <button onClick={handleBulkApprove}>✓ 通过当前筛选 ({visibleEntries.length})</button>
            <button onClick={handleBulkReject}>✗ 拒绝当前筛选 ({visibleEntries.length})</button>
            <button onClick={handleBulkReset}>↺ 重置当前筛选</button>
          </div>

          <div className="candidate-export-panel">
            <div className="candidate-export-grid">
              <label className="field">
                <span>难度下限</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={exportFilters.allowedDifficultyRange[0]}
                  onChange={(event) =>
                    setExportFilters((current) => ({
                      ...current,
                      allowedDifficultyRange: [Number(event.target.value), current.allowedDifficultyRange[1]]
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>难度上限</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={exportFilters.allowedDifficultyRange[1]}
                  onChange={(event) =>
                    setExportFilters((current) => ({
                      ...current,
                      allowedDifficultyRange: [current.allowedDifficultyRange[0], Number(event.target.value)]
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>单作品词条上限 (0=不限)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={exportFilters.franchiseQuota}
                  onChange={(event) =>
                    setExportFilters((current) => ({
                      ...current,
                      franchiseQuota: Number(event.target.value)
                    }))
                  }
                />
              </label>
            </div>
            <div className="chip-wrap">
              {(["low", "medium", "high"] as CandidateSpoilerRisk[]).map((risk) => (
                <button
                  key={risk}
                  className={exportFilters.allowedSpoilerRisks.includes(risk) ? "selected chip-button" : "chip-button"}
                  onClick={() =>
                    setExportFilters((current) => ({
                      ...current,
                      allowedSpoilerRisks: current.allowedSpoilerRisks.includes(risk)
                        ? current.allowedSpoilerRisks.filter((item) => item !== risk)
                        : [...current.allowedSpoilerRisks, risk]
                    }))
                  }
                >
                  spoiler {risk}
                </button>
              ))}
              {taxonomy.types.map((type) => (
                <button
                  key={type}
                  className={exportFilters.allowedTypes.includes(type) ? "selected chip-button" : "chip-button"}
                  onClick={() =>
                    setExportFilters((current) => ({
                      ...current,
                      allowedTypes: current.allowedTypes.includes(type)
                        ? current.allowedTypes.filter((item) => item !== type)
                        : [...current.allowedTypes, type]
                    }))
                  }
                >
                  {type}
                </button>
              ))}
            </div>
            <button className="primary-button" onClick={() => onExport(exportFilters)}>
              导出为可玩题库
            </button>
          </div>
        </div>

        <div className="candidate-list">
          {visibleEntries.length === 0 ? (
            <p className="empty-text">当前筛选条件下没有候选词条。</p>
          ) : (
            visibleEntries.map((entry) => {
              const issues = getCandidateEntryIssues(entry, pack.entries);
              return (
                <CandidateEntryCard
                  key={`${entry.display}-${entry.type}`}
                  entry={entry}
                  issues={issues}
                  onApprove={() => onUpdateEntry(entry.display, { reviewStatus: "approved" })}
                  onReject={() => onUpdateEntry(entry.display, { reviewStatus: "rejected" })}
                  onReset={() => onUpdateEntry(entry.display, { reviewStatus: "pending" })}
                />
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function CandidateEntryCard({
  entry,
  issues,
  onApprove,
  onReject,
  onReset
}: {
  entry: CandidateEntry;
  issues: CandidateEntryIssue[];
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
}) {
  const hasError = issues.some((issue) => issue.level === "error");

  return (
    <div className={`candidate-entry ${hasError ? "candidate-entry-error" : ""}`}>
      <div className="candidate-entry-main">
        <div>
          <strong>{entry.display}</strong>
          <p className="pack-card-meta">
            {entry.type} / {entry.franchise} / 难度 {entry.difficulty}
          </p>
          {entry.aliases.length > 0 ? <p className="pack-card-meta">aliases: {entry.aliases.join(" / ")}</p> : null}
          {entry.tags.length > 0 ? <p className="pack-card-meta">tags: {entry.tags.join(" / ")}</p> : null}
          {entry.reason ? <p className="pack-card-meta">{entry.reason}</p> : null}
          {entry.reviewNotes ? <p className="pack-card-meta hint-text">{entry.reviewNotes}</p> : null}
        </div>
        <div className="candidate-entry-side">
          <span className={`review-status review-${entry.reviewStatus}`}>{entry.reviewStatus}</span>
          <span className="soft-chip">unique {entry.uniquenessScore}</span>
          <span className="soft-chip">play {entry.playabilityScore}</span>
          <span className="soft-chip">spoiler {entry.spoilerRisk}</span>
        </div>
      </div>
      {issues.length > 0 ? (
        <div className="chip-wrap">
          {issues.map((issue) => (
            <span className={`issue-pill issue-${issue.level}`} key={`${entry.display}-${issue.code}`}>
              {issue.message}
            </span>
          ))}
        </div>
      ) : null}
      <div className="pack-card-actions">
        <button onClick={onApprove}>通过</button>
        <button onClick={onReject}>拒绝</button>
        <button onClick={onReset}>待审</button>
      </div>
    </div>
  );
}
