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
  settings
}: {
  lib: LibraryApi;
  onOpen: (doc: LibraryDoc) => void;
  settings: AppSettings;
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
            {lib.tab === "ai" && settings.aiEnabled && <AiPanel doc={doc} settings={settings} />}
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

interface AiMsg { role: "user" | "assistant"; text?: string; html?: string }

function composeReply(doc: LibraryDoc, q: string): string {
  const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  if (q.includes("方法")) {
    return "<strong>主要方法</strong><ul><li>论文：" + esc(doc.title) + "</li><li>核心思路：" + esc(doc.summary || doc.abstract) + "</li><li>关键组件与训练策略详见正文第 3–4 节，可对照 PDF 附件阅读。</li></ul>";
  }
  if (q.includes("局限")) {
    return "<strong>潜在局限（基于摘要的初步判断）</strong><ul><li>实验结论可能依赖特定数据集与规模设定，跨域泛化仍需验证。</li><li>计算与存储开销较大，落地时需权衡成本。</li><li>建议结合原文的局限性讨论章节与后续工作综合判断。</li></ul>";
  }
  return "<strong>核心贡献</strong><ul><li>" + esc(doc.summary || doc.abstract || "（暂无摘要，可在信息页补充）") + "</li><li>发表于 " + esc(doc.venue || "—") + " " + esc(doc.year || "") + "，作者：" + esc(doc.authors || "—") + "。</li></ul>";
}

function AiPanel({ doc, settings }: { doc: LibraryDoc; settings: AppSettings }): JSX.Element {
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); setInput(""); setTyping(false); }, [doc.id]);
  useEffect(() => { const el = scrollRef.current; if (el) { el.scrollTop = el.scrollHeight; } }, [messages, typing]);

  const send = (preset?: string): void => {
    const q = (preset !== undefined ? preset : input).trim();
    if (!q) { return; }
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { role: "assistant", html: composeReply(doc, q) }]);
    }, 900);
  };

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="ai-badge"><Icon name="sparkle" small /></span>
        <span>AI 助手</span>
        <span className="ai-scope od-truncate">上下文：{doc.title}</span>
      </div>
      <div className="ai-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="ai-intro">
            <div className="ai-mark"><Icon name="sparkle" /></div>
            <h3>用 AI 助手探索这篇文献</h3>
            <p>基于《{doc.title}》提问，快速获得摘要、方法与局限分析。</p>
            <div className="ai-suggest">
              <button onClick={() => send("总结核心贡献")}>总结核心贡献</button>
              <button onClick={() => send("解释主要方法")}>解释主要方法</button>
              <button onClick={() => send("分析局限")}>分析局限</button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={"msg " + (m.role === "user" ? "msg-user" : "msg-assistant")}>
                <div className="msg-avatar">{m.role === "user" ? "我" : <Icon name="sparkle" small />}</div>
                <div className="msg-body">
                  <div className="msg-role">{m.role === "user" ? "我" : "AI 助手"}</div>
                  {m.role === "user"
                    ? <div className="msg-content">{m.text}</div>
                    : <div className="msg-content" dangerouslySetInnerHTML={{ __html: m.html || "" }} />}
                </div>
              </div>
            ))}
            {typing && <div className="msg msg-assistant"><div className="msg-avatar"><Icon name="sparkle" small /></div><div className="msg-body"><div className="msg-content"><span className="typing"><i /><i /><i /></span></div></div></div>}
          </>
        )}
      </div>
      <div className="ai-composer">
        <form
          className="composer-box"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <textarea
            placeholder="随心输入"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="composer-row">
            <button type="button" className="icon-btn" aria-label="添加附件"><Icon name="plus" small /></button>
            <span className="od-fill" />
            <button type="submit" className="send-btn" aria-label="发送" disabled={!input.trim()}><Icon name="arrow-up" small /></button>
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
