import { useEffect, useRef, useState, type JSX } from "react";
import type { LibraryDoc } from "../../../shared/types";
import { Icon } from "./Icons";
import { formatDate } from "../lib/format";
import { getPdfjs } from "../lib/pdf";
import type { LibraryApi } from "../state/useLibrary";
import type { AppSettings } from "../state/settings";

function arxivId(url: string): string {
  const match = /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(String(url || ""));
  return match ? "arXiv:" + match[1] : "";
}

function docKind(doc: LibraryDoc): string {
  return doc.type || (/arxiv/i.test(doc.sourceUrl || "") ? "预印本" : "文档");
}

function citation(doc: LibraryDoc, withDoi: boolean): string {
  const authors = doc.authors || "Unknown";
  const year = doc.year || "n.d.";
  const venue = doc.venue ? doc.venue + ". " : "";
  const id = withDoi ? doc.doi || arxivId(doc.sourceUrl) || "" : "";
  return `${authors} (${year}). ${doc.title}. ${venue}${id}`.trim();
}

export default function DetailPanel({
  lib,
  onOpen,
  settings,
  aiSelection,
  onCite,
  onClearSelection
}: {
  lib: LibraryApi;
  onOpen: (doc: LibraryDoc) => void;
  settings: AppSettings;
  aiSelection?: { text: string; page: number } | null;
  onCite?: (docId: string, page: number) => void;
  onClearSelection?: () => void;
}): JSX.Element {
  const doc = lib.selected;

  function openDoc(d: LibraryDoc): void {
    onOpen(d);
  }

  return (
    <aside className="detail" aria-label="文献详情">
      <div className="tab-body">
        {!doc ? (
          <div className="empty">
            <div className="empty-mark"><Icon name="file" /></div>
            <h3>未选择文献</h3>
            <p>从中间列表选择一篇文献以查看信息、PDF 预览、笔记与标签。</p>
          </div>
        ) : (
          <div className="tab-panel">
            {lib.tab === "info" && (lib.editMode
              ? <InfoEdit lib={lib} doc={doc} />
              : <InfoDisplay lib={lib} doc={doc} onOpenView={openDoc} citeDoi={settings.citeDoi} />)}
            {lib.tab === "notes" && <NotesPanel lib={lib} doc={doc} />}
            {lib.tab === "tags" && <TagsPanel lib={lib} doc={doc} />}
            {lib.tab === "ai" && settings.aiEnabled && <AiPanel doc={doc} settings={settings} selection={aiSelection} onCite={onCite || (() => {})} onClearSelection={onClearSelection || (() => {})} />}
          </div>
        )}
      </div>
    </aside>
  );
}

function InfoDisplay({ lib, doc, onOpenView, citeDoi }: { lib: LibraryApi; doc: LibraryDoc; onOpenView: (d: LibraryDoc) => void; citeDoi: boolean }): JSX.Element {
  const ident = doc.doi || arxivId(doc.sourceUrl) || "—";
  const colNames = doc.collections.map((c) => lib.collections.find((x) => x.id === c)?.name).filter(Boolean);
  const tags = doc.tags || [];
  return (
    <>
      <span className="doc-kind"><Icon name={docKind(doc) === "预印本" ? "globe" : "file"} small />{docKind(doc)}</span>
      <h2 className="doc-title">{doc.title}</h2>
      {doc.authors && <p className="doc-authors">{doc.authors}</p>}
      <dl className="meta-grid">
        <dt>年份</dt><dd>{doc.year || "—"}</dd>
        <dt>来源</dt><dd>{doc.venue || "—"}</dd>
        <dt>标识符</dt><dd>{ident}</dd>
        <dt>添加日期</dt><dd>{formatDate(doc.added_at)}</dd>
      </dl>
      {colNames.length > 0 && (<><div className="section-title">分类</div><div className="tag-cloud">{colNames.map((n) => <span className="tag" key={n}>{n}</span>)}</div></>)}

      {(doc.abstract || doc.summary) && (<><div className="section-title">摘要</div><p className="abstract">{doc.abstract || doc.summary}</p></>)}

      <div className="section-title">附件</div>
      <button className="attach attach-btn" onClick={() => onOpenView(doc)}>
        <span className="attach-ic"><Icon name="file" small /></span>
        <span className="item-main">
          <span className="attach-name od-truncate">{doc.sourceName || "source.pdf"}</span>
          <span className="attach-meta">已保存 · 全文可检索</span>
        </span>
        <span className="od-fill" />
        <span className="item-type"><Icon name="external" small /></span>
      </button>

      <div className="section-title">预览</div>
      <DocPreview doc={doc} />

      <div className="section-title">标签</div>
      <div className="tag-cloud">
        {tags.map((t) => <button key={t} className="tag" onClick={() => lib.setTag(t)}>{t}</button>)}
        <button className="tag-add" onClick={() => lib.setTab("tags")}><Icon name="plus" small /> 添加</button>
      </div>
    </>
  );
}

function InfoEdit({ lib, doc }: { lib: LibraryApi; doc: LibraryDoc }): JSX.Element {
  const [form, setForm] = useState({
    title: doc.title, authors: doc.authors, year: doc.year, venue: doc.venue,
    doi: doc.doi, type: doc.type, abstract: doc.abstract, summary: doc.summary
  });
  const [cols, setCols] = useState<string[]>(doc.collections || []);
  const set = (k: keyof typeof form, v: string): void => setForm((f) => ({ ...f, [k]: v }));
  const inputStyle = { height: 34, background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", color: "var(--text)", padding: "0 10px", outline: "none" } as const;
  return (
    <>
      <h2 className="doc-title">编辑文献</h2>
      <div className="field"><label>标题</label><input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} /></div>
      <div className="field"><label>作者</label><input style={inputStyle} value={form.authors} onChange={(e) => set("authors", e.target.value)} /></div>
      <div className="field-row">
        <div className="field"><label>年份</label><input style={inputStyle} value={form.year} onChange={(e) => set("year", e.target.value)} /></div>
        <div className="field"><label>来源</label><input style={inputStyle} value={form.venue} onChange={(e) => set("venue", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>标识符</label><input style={inputStyle} value={form.doi} onChange={(e) => set("doi", e.target.value)} /></div>
        <div className="field"><label>类型</label><input style={inputStyle} value={form.type} onChange={(e) => set("type", e.target.value)} /></div>
      </div>
      <div className="field">
        <label>分类</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {lib.collections.length === 0 && <span className="muted" style={{ fontSize: 12 }}>无分类</span>}
          {lib.collections.map((c) => (
            <label key={c.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, color: "var(--text-2)" }}>
              <input
                type="checkbox"
                checked={cols.includes(c.id)}
                onChange={(e) => setCols((cur) => e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id))}
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>
      <div className="field"><label>摘要</label><textarea style={{ ...inputStyle, height: 100, padding: 10, resize: "vertical" }} value={form.abstract} onChange={(e) => set("abstract", e.target.value)} /></div>
      <div className="detail-actions">
        <button className="btn btn-primary" onClick={async () => { await lib.update(doc.id, { ...form, collections: cols }); lib.setEditMode(false); }}>完成</button>
        <button className="btn btn-ghost" onClick={() => lib.setEditMode(false)}>取消</button>
      </div>
    </>
  );
}

function NotesPanel({ lib, doc }: { lib: LibraryApi; doc: LibraryDoc }): JSX.Element {
  const [input, setInput] = useState("");
  const notes = doc.notes || [];
  useEffect(() => { setInput(""); }, [doc.id]);
  const add = (): void => {
    const text = input.trim();
    if (!text) { return; }
    const note = { id: "n" + Date.now(), text, date: new Date().toISOString().slice(0, 10) };
    void lib.update(doc.id, { notes: [note, ...notes] });
    setInput("");
  };
  return (
    <>
      <div className="note-editor">
        <textarea
          value={input}
          placeholder={`为《${doc.title}》添加一条笔记…`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
        />
        <div className="od-row">
          <span className="od-fill" />
          <button className="btn btn-primary" onClick={add}><Icon name="plus" small /> 保存笔记</button>
        </div>
      </div>
      {notes.length === 0 ? (
        <p className="empty" style={{ padding: "20px 0", color: "var(--faint)" }}>还没有笔记，写一条吧。</p>
      ) : (
        notes.map((n) => (
          <div className="note-card" key={n.id}>
            <p>{n.text}</p>
            <time>{n.date}</time>
          </div>
        ))
      )}
    </>
  );
}

function TagsPanel({ lib, doc }: { lib: LibraryApi; doc: LibraryDoc }): JSX.Element {
  const [input, setInput] = useState("");
  const tags = doc.tags || [];
  const all = Object.keys(lib.tagCounts).sort();
  const add = (): void => {
    const tag = input.trim();
    if (!tag) { return; }
    if (!tags.includes(tag)) { void lib.update(doc.id, { tags: [...tags, tag] }); }
    setInput("");
  };
  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>当前标签</div>
      <div className="tag-cloud">
        {tags.length === 0 ? <span style={{ color: "var(--faint)", fontSize: 13 }}>暂无标签</span>
          : tags.map((t) => <button className="tag" key={t} onClick={() => lib.setTag(t)}>{t}</button>)}
      </div>
      <div className="section-title">添加标签</div>
      <div className="od-row">
        <input
          className="od-fill"
          value={input}
          placeholder="输入标签后回车"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { add(); } }}
          style={{ height: 38, padding: "0 11px", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 10, outline: "none", color: "var(--text)" }}
        />
        <button className="btn btn-primary" onClick={add}><Icon name="plus" small /> 添加</button>
      </div>
      <div className="section-title">所有标签</div>
      <div className="tag-cloud">
        {all.length === 0 ? <span style={{ color: "var(--faint)", fontSize: 13 }}>无</span>
          : all.map((t) => <button className="tag" key={t} onClick={() => lib.setTag(t)}>{t}</button>)}
      </div>
    </>
  );
}

interface AiToolTrace { name: string; args?: string; content?: string }
interface AiTurn {
  role: "user" | "assistant";
  text: string;
  tools?: AiToolTrace[];
  reasoning?: string;
  error?: string;
  streaming?: boolean;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const CITE_RE = /\[\[cite:([0-9a-fA-F]*)#(\d+)\]\]/g;

function renderWithCitations(text: string, onCite: (docId: string, page: number) => void): JSX.Element[] {
  const nodes: JSX.Element[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  let k = 0;
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > last) { nodes.push(<span key={"t" + k++}>{text.slice(last, m.index)}</span>); }
    const id = m[1];
    const page = parseInt(m[2], 10);
    nodes.push(<button key={"c" + k++} type="button" className="cite-chip" onClick={() => onCite(id, page)}>第 {page} 页</button>);
    last = m.index + m[0].length;
  }
  if (last < text.length) { nodes.push(<span key={"t" + k++}>{text.slice(last)}</span>); }
  return nodes;
}

function AiPanel({ doc, settings, selection, onCite, onClearSelection }: {
  doc: LibraryDoc;
  settings: AppSettings;
  selection?: { text: string; page: number } | null;
  onCite: (docId: string, page: number) => void;
  onClearSelection: () => void;
}): JSX.Element {
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"paper" | "library">("paper");
  const [sending, setSending] = useState(false);
  const turnRef = useRef("");
  const turnsRef = useRef<AiTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  turnsRef.current = turns;

  useEffect(() => { setTurns([]); setInput(""); setSending(false); turnRef.current = ""; }, [doc.id]);
  useEffect(() => { const el = scrollRef.current; if (el) { el.scrollTop = el.scrollHeight; } }, [turns]);

  useEffect(() => {
    const off = window.api.onAgentEvent((e) => {
      if (e.turnId !== turnRef.current) { return; }
      setTurns((prev) => {
        if (prev.length === 0) { return prev; }
        const next = prev.slice();
        const i = next.length - 1;
        const cur: AiTurn = { ...next[i] };
        if (e.type === "delta" && e.text) { cur.text += e.text; }
        else if (e.type === "reasoning" && e.text) { cur.reasoning = (cur.reasoning || "") + e.text; }
        else if (e.type === "tool_call") { cur.tools = [...(cur.tools || []), { name: e.name || "", args: e.args }]; }
        else if (e.type === "tool_result") {
          const tools = (cur.tools || []).slice();
          for (let j = tools.length - 1; j >= 0; j--) { if (tools[j].name === e.name) { tools[j] = { ...tools[j], content: e.content }; break; } }
          cur.tools = tools;
        }
        else if (e.type === "usage") { cur.usage = e.usage; }
        else if (e.type === "error") { cur.error = e.error || "出错了"; cur.streaming = false; }
        else if (e.type === "done") { cur.streaming = false; }
        next[i] = cur;
        return next;
      });
      if (e.type === "done" || e.type === "error") { setSending(false); }
    });
    return off;
  }, []);

  const send = (preset?: string): void => {
    const q = (preset !== undefined ? preset : input).trim();
    if (!q || sending) { return; }
    setInput("");
    const history = turnsRef.current
      .filter((t) => t.text.trim())
      .map((t) => ({ role: t.role, content: t.text }));
    setTurns((prev) => [...prev, { role: "user", text: q }, { role: "assistant", text: "", streaming: true }]);
    setSending(true);
    const sel = selection ? selection : undefined;
    void window.api.agentChat({ scope, docId: doc.id, selection: sel, message: q, history })
      .then(({ turnId }) => { turnRef.current = turnId; })
      .catch((err) => {
        setSending(false);
        setTurns((prev) => {
          const next = prev.slice();
          const i = next.length - 1;
          next[i] = { ...next[i], streaming: false, error: String(err?.message || err) };
          return next;
        });
      });
    onClearSelection();
  };

  const stop = (): void => { if (turnRef.current) { void window.api.agentCancel(turnRef.current); } };

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="ai-badge"><Icon name="sparkle" small /></span>
        <div className="ai-scope-tabs">
          <button type="button" className={scope === "paper" ? "active" : ""} onClick={() => setScope("paper")}>当前文章</button>
          <button type="button" className={scope === "library" ? "active" : ""} onClick={() => setScope("library")}>全库</button>
        </div>
      </div>
      <div className="ai-scroll" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="ai-intro">
            <div className="ai-mark"><Icon name="sparkle" /></div>
            <h3>{scope === "paper" ? "就这篇文献提问" : "跨文库提问"}</h3>
            <p>{scope === "paper" ? `基于《${doc.title}》检索并作答，回答带可点击引用。` : "在整本文库中检索相关段落并综合作答。"}</p>
            <div className="ai-suggest">
              <button onClick={() => send("总结核心贡献")}>总结核心贡献</button>
              <button onClick={() => send("解释主要方法")}>解释主要方法</button>
              <button onClick={() => send("分析局限性")}>分析局限性</button>
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={"msg " + (t.role === "user" ? "msg-user" : "msg-assistant")}>
              <div className="msg-avatar">{t.role === "user" ? "我" : <Icon name="sparkle" small />}</div>
              <div className="msg-body">
                <div className="msg-role">{t.role === "user" ? "我" : "AI 助手"}</div>
                {t.role === "user" ? (
                  <div className="msg-content">{t.text}</div>
                ) : (
                  <>
                    {t.tools && t.tools.length > 0 && (
                      <details className="ai-tools">
                        <summary>工具调用（{t.tools.length}）</summary>
                        {t.tools.map((tool, j) => (
                          <div key={j} className="ai-tool"><span className="ai-tool-name">{tool.name}</span>{tool.args ? <span className="ai-tool-args">{tool.args}</span> : null}</div>
                        ))}
                      </details>
                    )}
                    <div className="msg-content ai-md">{renderWithCitations(t.text, onCite)}</div>
                    {t.error ? <div className="ai-error">{t.error}</div> : null}
                    {t.streaming && !t.text ? <span className="typing"><i /><i /><i /></span> : null}
                    {t.usage ? <div className="ai-usage">tokens: {t.usage.prompt_tokens}+{t.usage.completion_tokens}</div> : null}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="ai-composer">
        {selection && selection.text.trim() ? (
          <div className="ai-selection">
            <span className="od-truncate">已选文本（第 {selection.page} 页）：{selection.text.trim().slice(0, 120)}</span>
            <button type="button" className="icon-btn" title="移除" onClick={onClearSelection}><Icon name="x" small /></button>
          </div>
        ) : null}
        <form className="composer-box" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            placeholder="随心输入"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="composer-row">
            <span className="od-fill" />
            {sending
              ? <button type="button" className="send-btn" title="停止" onClick={stop}><Icon name="x" small /></button>
              : <button type="submit" className="send-btn" aria-label="发送" disabled={!input.trim()}><Icon name="arrow-up" small /></button>}
          </div>
        </form>
      </div>
    </div>
  );
}

function DocPreview({ doc }: { doc: LibraryDoc }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const docRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    docRef.current = null;
    setNumPages(0);
    setPage(1);
    (async () => {
      try {
        const data = await window.api.libraryOpen(doc.id);
        if (!data.bytes) { return; }
        const pdfjs = await getPdfjs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(data.bytes) }).promise;
        if (cancelled) { return; }
        docRef.current = pdf;
        setNumPages(pdf.numPages);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [doc.id]);

  useEffect(() => {
    const pdf = docRef.current;
    if (!pdf) { return; }
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) { return; }
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: (300 * zoom) / base.width });
      const canvas = canvasRef.current;
      if (!canvas) { return; }
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await p.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    })();
    return () => { cancelled = true; };
  }, [numPages, page, zoom]);

  return (
    <div className="reader reader-inline">
      <div className="reader-stage">
        {numPages === 0
          ? <span style={{ color: "var(--faint)", fontSize: 12 }}>正在生成预览…</span>
          : <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto", background: "#fff", boxShadow: "0 10px 26px rgba(0,0,0,.5)" }} />}
      </div>
      <div className="reader-toolbar">
        <button className="icon-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><Icon name="chev-left" small /></button>
        <span className="pill">{page} / {numPages || "?"}</span>
        <button className="icon-btn" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}><Icon name="chev-right" small /></button>
        <span className="od-fill" />
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}><Icon name="zoom-out" small /></button>
        <span className="pill zoom-val">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(2, z + 0.2))}><Icon name="zoom-in" small /></button>
        <button className="icon-btn" onClick={() => setZoom(1)}><Icon name="expand" small /></button>
      </div>
    </div>
  );
}
