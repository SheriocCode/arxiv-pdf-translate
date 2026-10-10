import type { JSX } from "react";
import { Icon } from "./Icons";
import type { LibraryApi } from "../state/useLibrary";
import { PSEUDO } from "../state/useLibrary";

const LOG_CATS = [
  { id: "tlog", name: "翻译日志", icon: "log" },
  { id: "ailog", name: "AI对话日志", icon: "message" },
  { id: "syslog", name: "系统运行日志", icon: "terminal" }
];
const LOG_STATUS = [
  { id: "all", name: "全部" },
  { id: "done", name: "已完成" },
  { id: "running", name: "进行中" },
  { id: "failed", name: "失败" }
];
const READ_BUCKETS = ["今天", "昨天", "本周", "更早"];

function bucketOf(ts: number): string {
  const now = new Date();
  const d = new Date(ts * 1000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  const t = d.getTime();
  if (t >= startOfToday) { return "今天"; }
  if (t >= startOfToday - day) { return "昨天"; }
  if (t >= startOfToday - 6 * day) { return "本周"; }
  return "更早";
}

export default function Sidebar({
  lib,
  onOpenDoc,
  showCounts,
  logCat,
  setLogCat,
  logStatus,
  setLogStatus
}: {
  lib: LibraryApi;
  onOpenDoc: (id: string) => void;
  showCounts: boolean;
  logCat: string;
  setLogCat: (v: string) => void;
  logStatus: string;
  setLogStatus: (v: string) => void;
}): JSX.Element {
  return (
    <aside className="sidebar" aria-label="文库与分类">
      <div className="side-search">
        <div className="search-field">
          <Icon name="search" small />
          <input
            type="search"
            placeholder="搜索标题、作者、标签…"
            value={lib.query}
            onChange={(e) => lib.setQuery(e.target.value)}
          />
          <span className="kbd">/</span>
        </div>
      </div>
      <div className="side-scroll">
        {lib.section === "recent" ? (
          <RecentTree lib={lib} onOpenDoc={onOpenDoc} />
        ) : lib.section === "logs" ? (
          <LogTree logCat={logCat} setLogCat={setLogCat} logStatus={logStatus} setLogStatus={setLogStatus} />
        ) : (
          <LibraryTree lib={lib} showCounts={showCounts} />
        )}
      </div>
    </aside>
  );
}

function groupHead(name: string): JSX.Element {
  return (
    <div className="side-group-head">
      <span className="chev"><Icon name="chev-down" small /></span>
      {name}
    </div>
  );
}

function LibraryTree({ lib, showCounts }: { lib: LibraryApi; showCounts: boolean }): JSX.Element {
  const tags = Object.keys(lib.tagCounts).sort();
  const parents = lib.collections.filter((c) => !c.parent);
  const Count = ({ n }: { n: number }) => showCounts ? <span className="side-item-count">{n}</span> : <span />;
  return (
    <>
      <div className="side-group">
        {groupHead("我的文库")}
        <div className="side-list">
          {PSEUDO.map((node) => (
            <button
              key={node.id}
              className={"side-item" + (lib.collId === node.id && !lib.tag ? " is-active" : "")}
              onClick={() => { lib.setTag(""); lib.setCollId(node.id); }}
            >
              <span className="side-item-icon"><Icon name={node.icon} small /></span>
              <span className="side-item-name">{node.name}</span>
              <Count n={lib.countFor(node.id)} />
            </button>
          ))}
        </div>
      </div>

      {parents.map((parent) => (
        <div className="side-group" key={parent.id}>
          {groupHead(parent.name)}
          <div className="side-list">
            <div className="side-sub">
              <button
                className={"side-item" + (lib.collId === parent.id && !lib.tag ? " is-active" : "")}
                onClick={() => { lib.setTag(""); lib.setCollId(parent.id); }}
              >
                <span className="side-item-icon"><Icon name="folder" small /></span>
                <span className="side-item-name">全部 {parent.name}</span>
                <Count n={lib.countFor(parent.id)} />
              </button>
              {lib.collections.filter((c) => c.parent === parent.id).map((child) => (
                <button
                  key={child.id}
                  className={"side-item" + (lib.collId === child.id && !lib.tag ? " is-active" : "")}
                  onClick={() => { lib.setTag(""); lib.setCollId(child.id); }}
                >
                  <span className="side-item-icon"><Icon name="tag" small /></span>
                  <span className="side-item-name">{child.name}</span>
                  <span
                    className="side-item-count"
                    title="删除分类"
                    onClick={(e) => { e.stopPropagation(); if (confirm("删除该分类？")) { void lib.removeCollection(child.id); } }}
                  >×</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
      <div className="side-group">
        {groupHead("新建分类")}
        <div className="side-list">
          <div className="side-sub">
            <button className="side-item" onClick={() => { const n = prompt("父分类名称（可留空）"); if (n === null) { return; } const name = n.trim() || "新分类"; void lib.addCollection(name, null); }}>
              <span className="side-item-icon"><Icon name="folder" small /></span>
              <span className="side-item-name">新建分类…</span>
            </button>
          </div>
        </div>
      </div>

      <div className="side-group">
        {groupHead("我的标签")}
        <div className="side-list">
          <div className="side-sub">
            {tags.length === 0 ? (
              <div className="side-empty">无标签</div>
            ) : (
              tags.map((t) => (
                <button
                  key={t}
                  className={"side-item" + (lib.tag === t ? " is-active" : "")}
                  onClick={() => { lib.setTag(t); lib.setCollId("all"); }}
                >
                  <span className="side-item-icon"><Icon name="tag" small /></span>
                  <span className="side-item-name">{t}</span>
                  <Count n={lib.tagCounts[t]} />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function RecentTree({ lib, onOpenDoc }: { lib: LibraryApi; onOpenDoc: (id: string) => void }): JSX.Element {
  const byId = new Map(lib.documents.map((d) => [d.id, d]));
  return (
    <>
      {READ_BUCKETS.map((bucket) => {
        const rows = lib.history.filter((r) => bucketOf(r.at) === bucket && byId.has(r.itemId) && !byId.get(r.itemId)!.trash);
        if (rows.length === 0) { return null; }
        return (
          <div className="side-group" key={bucket}>
            {groupHead(bucket)}
            <div className="side-list">
              <div className="side-sub">
                {rows.map((r) => {
                  const doc = byId.get(r.itemId)!;
                  return (
                    <button key={r.itemId + r.at} className="side-item side-doc" onClick={() => onOpenDoc(r.itemId)}>
                      <span className="side-item-icon"><Icon name="book" small /></span>
                      <span className="side-item-name" title={doc.title}>{doc.title}</span>
                      <span className="side-item-count">{new Date(r.at * 1000).toTimeString().slice(0, 5)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      {lib.history.length === 0 && <div className="side-empty">暂无阅读记录</div>}
    </>
  );
}

function LogTree({
  logCat,
  setLogCat,
  logStatus,
  setLogStatus
}: {
  logCat: string;
  setLogCat: (v: string) => void;
  logStatus: string;
  setLogStatus: (v: string) => void;
}): JSX.Element {
  return (
    <>
      <div className="side-group">
        {groupHead("日志")}
        <div className="side-list">
          {LOG_CATS.map((cat) => (
            <button key={cat.id} className={"side-item" + (logCat === cat.id ? " is-active" : "")} onClick={() => setLogCat(cat.id)}>
              <span className="side-item-icon"><Icon name={cat.icon} small /></span>
              <span className="side-item-name">{cat.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="side-group">
        {groupHead("状态")}
        <div className="side-list">
          <div className="side-sub">
            {LOG_STATUS.map((s) => (
              <button key={s.id} className={"side-item" + (logStatus === s.id ? " is-active" : "")} onClick={() => setLogStatus(s.id)}>
                <span className="side-item-icon"><Icon name="file" small /></span>
                <span className="side-item-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
