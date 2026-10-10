import { useEffect, useMemo, useState, type JSX } from "react";
import type { StorageEntry } from "../../../shared/types";
import { Icon } from "./Icons";

interface Step { kind: string; name?: string; text?: string; args?: Record<string, unknown>; note?: string; result?: string; ms?: number }
interface Track { id: string; title: string; status: string; started: string; lang: string; steps: Step[] }

const LANES = ["任务", "工具", "助手"];
const DETAIL_TABS = ["概述", "参数", "结果", "计时"];

function kindSlug(k: string): string {
  return k === "工具" ? "tool" : k === "助手" ? "assistant" : k === "用户" ? "user" : k === "系统" ? "sys" : "task";
}

function buildTrack(entry: StorageEntry): Track {
  const lang = entry.target_lang || "简体中文";
  const name = entry.name || entry.id;
  return {
    id: entry.id,
    title: name,
    status: "done",
    started: new Date((entry.created_at || 0) * 1000).toLocaleString(),
    lang,
    steps: [
      { kind: "任务", name: "翻译任务", note: "目标语言：" + lang, result: "已创建翻译任务：" + name, ms: 120 },
      { kind: "工具", name: "fetch_pdf", args: { file: entry.source_name || name }, note: "（仅工具调用）", result: "读取源 PDF 完成", ms: 1240 },
      { kind: "助手", text: "先建立术语表，再逐段翻译并回填，保持公式与引用编号。" },
      { kind: "工具", name: "translate_chunk", args: { target: lang, style: "学术" }, note: "（仅工具调用）", result: "逐段翻译完成", ms: 3200 },
      { kind: "工具", name: "export_bilingual_pdf", args: { layout: "左右对照", format: "pdf" }, note: "（仅工具调用）", result: "生成 " + name, ms: 1450 }
    ]
  };
}

function stepTimes(track: Track): { start: Date; total: number; ms: number }[] {
  const base = track.started ? new Date(track.started) : new Date();
  let acc = 0;
  return track.steps.map((s) => {
    const start = new Date(base.getTime() + acc);
    acc += s.ms || 500;
    return { start, total: acc, ms: s.ms || 500 };
  });
}

export default function LogsView({
  logKey,
  logStatus,
  onClose
}: {
  logKey: string;
  logStatus: string;
  onClose: () => void;
}): JSX.Element {
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [trackId, setTrackId] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [stepKind, setStepKind] = useState("all");
  const [detailTab, setDetailTab] = useState("概述");
  const [lane, setLane] = useState("");

  useEffect(() => {
    void window.api.listStorage().then((d) => { setEntries(d.entries); setTrackId(d.entries[0] ? d.entries[0].id : ""); });
  }, []);

  const tracks = useMemo<Track[]>(() => (logKey === "tlog" ? entries.map(buildTrack) : []), [entries, logKey]);
  const filtered = useMemo(() => logStatus === "all" ? tracks : tracks.filter((t) => t.status === logStatus), [tracks, logStatus]);
  const track = filtered.find((t) => t.id === trackId) || filtered[0];

  const times = track ? stepTimes(track) : [];
  const steps = track ? track.steps : [];
  const shownSteps = steps.map((s, i) => ({ s, i })).filter((o) => stepKind === "all" || o.s.kind === stepKind);
  const laneCounts: Record<string, number> = {};
  LANES.forEach((k) => { laneCounts[k] = 0; });
  steps.forEach((s) => { laneCounts[s.kind] = (laneCounts[s.kind] || 0) + 1; });

  const logTitles: Record<string, string> = { tlog: "翻译日志", ailog: "AI对话日志", syslog: "系统运行日志" };

  const totalMs = times.length ? times[times.length - 1].total || 1 : 1;
  const PX = 640 / totalMs;
  const baseMs = times.length ? times[0].start.getTime() : 0;
  const laneH = 10, gap = 3, PAD = 12;

  const selected = steps[stepIndex] || steps[0];

  return (
    <section className="history" aria-label="日志">
      <div className="hist-head">
        <div className="hist-heading">
          <h2>{logTitles[logKey] || "日志"}</h2>
          <span className="hist-badge">{filtered.length} 条</span>
        </div>
        <button className="icon-btn" title="关闭" onClick={onClose} style={{ marginLeft: "auto" }}><Icon name="x" small /></button>
      </div>
      {!track ? (
        <div className="hist-empty">暂无记录</div>
      ) : (
        <div className="hist-body">
          <div className="hist-main">
            <div className="tl-wrap">
              <div className="tl-gutter">
                {LANES.map((l) => (
                  <button key={l} className={"tl-lane-label" + (lane === l ? " is-active" : "")} title={"选中「" + l + "」泳道"} onClick={() => setLane(lane === l ? "" : l)}>{l}</button>
                ))}
              </div>
              <div className="tl-scroll">
                <div className="tl-track" style={{ width: PAD * 2 + totalMs * PX, height: LANES.length * laneH + (LANES.length - 1) * gap }}>
                  {steps.map((s, i) => {
                    const li = Math.max(0, LANES.indexOf(s.kind));
                    return (
                      <button
                        key={i}
                        className={"tl-block kind-" + kindSlug(s.kind) + (lane === s.kind ? " is-range" : "") + (lane && lane !== s.kind ? " is-dim" : "") + (i === stepIndex ? " is-active" : "")}
                        title={(s.name || s.kind) + " · " + (s.ms || 0) + " ms"}
                        style={{ left: PAD + (times[i].start.getTime() - baseMs) * PX, width: Math.max(8, (s.ms || 500) * PX), top: li * (laneH + gap) }}
                        onClick={() => { setStepIndex(i); setLane(""); }}
                      />
                    );
                  })}
                  <div className="tl-playhead" style={{ left: PAD + ((times[stepIndex] || times[0]).start.getTime() - baseMs) * PX, height: LANES.length * laneH + 6 }} />
                </div>
              </div>
            </div>
            <div className="hist-filters">
              <button className="hist-chip" aria-pressed={stepKind === "all"} onClick={() => { setStepKind("all"); setLane(""); }}>全部 <span className="cnt">{steps.length}</span></button>
              {LANES.map((k) => (
                <button key={k} className="hist-chip" aria-pressed={stepKind === k} onClick={() => { setStepKind(k); setLane(""); }}>{k} <span className="cnt">{laneCounts[k] || 0}</span></button>
              ))}
            </div>
            <div className="hist-log">
              {shownSteps.length === 0 ? (
                <div className="hist-empty">没有匹配的步骤</div>
              ) : (
                shownSteps.map(({ s, i }) => {
                  const isMsg = s.kind === "助手" || s.kind === "用户";
                  return (
                    <button key={i} className={"hist-step" + (i === stepIndex ? " is-selected" : "")} onClick={() => { setStepIndex(i); setLane(""); }}>
                      <span className={"hist-step-dot kind-" + kindSlug(s.kind)} />
                      <span className={"hist-step-kind kind-" + kindSlug(s.kind)}>{s.kind}</span>
                      <span className="hist-step-main">
                        {isMsg ? (
                          <span className="hist-step-text">{s.text || ""}</span>
                        ) : (
                          <>
                            <span className="hist-step-name">{s.name || ""}</span>
                            {s.args && <span className="hist-step-args od-truncate">{JSON.stringify(s.args)}</span>}
                            {s.note && <span className="hist-step-note">{s.note}</span>}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="hist-detail">
            <div className="hist-detail-head">
              <span className={"hist-step-kind kind-" + kindSlug(selected.kind)}>{selected.kind}</span>
              <span className="hist-detail-title">第 {stepIndex + 1} 步</span>
            </div>
            <div className="hist-detail-tabs" role="tablist">
              {DETAIL_TABS.map((x) => (
                <button key={x} role="tab" aria-selected={detailTab === x} onClick={() => setDetailTab(x)}>{x}</button>
              ))}
            </div>
            <div className="hist-detail-body">
              {detailTab === "概述" && (
                <dl className="hist-meta">
                  <dt>类型</dt><dd>{selected.kind}</dd>
                  <dt>名称</dt><dd>{selected.name || "（消息）"}</dd>
                  <dt>状态</dt><dd>已完成</dd>
                  <dt>所属任务</dt><dd>{track.title}</dd>
                  {selected.note && <><dt>说明</dt><dd>{selected.note}</dd></>}
                </dl>
              )}
              {detailTab === "参数" && <pre className="hist-code">{selected.args ? JSON.stringify(selected.args, null, 2) : "（无参数）"}</pre>}
              {detailTab === "结果" && <p className="hist-result">{selected.result || (selected.text ? "（消息，无工具返回）" : "（无返回）")}</p>}
              {detailTab === "计时" && (
                <dl className="hist-meta">
                  <dt>开始时间</dt><dd>{(times[stepIndex] || times[0])?.start.toTimeString().slice(0, 8)}</dd>
                  <dt>时长</dt><dd>{selected.ms || 500} ms</dd>
                  <dt>累计耗时</dt><dd>{(times[stepIndex] || times[0])?.total || 0} ms</dd>
                  <dt>轮次</dt><dd>第 {stepIndex + 1} 步 / 共 {steps.length} 步</dd>
                </dl>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
