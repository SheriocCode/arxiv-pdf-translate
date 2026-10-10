import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import * as library from "../library";
import { runChat, modelConfigured, type ChatMessage } from "./model";
import { toolDefs, runTool } from "./tools";

export interface AgentChatRequest {
  scope: "paper" | "library";
  docId?: string;
  selection?: { text: string; page: number };
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface AgentEvent {
  turnId: string;
  type: "delta" | "reasoning" | "tool_call" | "tool_result" | "usage" | "done" | "error";
  text?: string;
  name?: string;
  args?: string;
  content?: string;
  error?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const MAX_ROUNDS = 6;

const SYSTEM_PROMPT = [
  "你是一个严谨的文献研究助手，帮助用户在本地文献库中检索、阅读并回答问题。",
  "你可以调用工具：list_library（浏览文库）、search_library（跨文献检索段落）、read_document（读取某篇文献正文）、search_in_document（单篇内检索）。",
  "工作方式：先检索/阅读相关证据，再基于证据作答；不要凭空编造。",
  "若【对话范围】为当前文章：只能使用 read_document / search_in_document，且 docId 必须是当前文章 id，不要引用或检索其它文献。",
  "若【对话范围】为全库：可跨文献使用 list_library / search_library 等全部工具。",
  "引用要求：每当陈述来自某段文献时，必须用 [[cite:文献id#页码]] 的形式标注来源（页码为 1 起）。这些标记会渲染成可点击跳转的引用。",
  "回答语言跟随用户提问语言（默认中文）。可以适度使用 Markdown。"
].join("\n");

export class AgentService extends EventEmitter {
  private controllers = new Map<string, AbortController>();

  run(req: AgentChatRequest): { turnId: string } {
    const turnId = crypto.randomBytes(8).toString("hex");
    const controller = new AbortController();
    this.controllers.set(turnId, controller);
    void this.execute(turnId, req, controller.signal)
      .catch((err) => this.emitEvent({ turnId, type: "error", error: (err as Error)?.message || String(err) }))
      .finally(() => { this.controllers.delete(turnId); });
    return { turnId };
  }

  cancel(turnId: string): void {
    this.controllers.get(turnId)?.abort();
  }

  private emitEvent(event: AgentEvent): void {
    this.emit("event", event);
  }

  private buildMessages(req: AgentChatRequest): ChatMessage[] {
    if (!modelConfigured()) {
      throw new Error("未配置模型：请在设置中填写 OpenAI 兼容的基础地址 / 密钥 / 模型");
    }
    const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
    for (const m of req.history || []) {
      messages.push({ role: m.role, content: m.content });
    }

    const ctx: string[] = [];
    if (req.scope === "paper" && req.docId) {
      const doc = library.getDocument(req.docId);
      ctx.push(`【对话范围】当前文章`);
      ctx.push(`【当前文章】《${doc ? doc.title : req.docId}》(id: ${req.docId})`);
    } else {
      ctx.push(`【对话范围】全库（可跨文献检索）`);
    }
    if (req.selection && req.selection.text.trim()) {
      ctx.push(`【用户选中的文本】第 ${req.selection.page} 页：“${req.selection.text.trim()}”`);
    }
    ctx.push(`【用户问题】${req.message}`);
    messages.push({ role: "user", content: ctx.join("\n") });
    return messages;
  }

  private async execute(turnId: string, req: AgentChatRequest, signal: AbortSignal): Promise<void> {
    const messages = this.buildMessages(req);
    const tools = toolDefs(req.scope);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) { throw new Error("已取消"); }
      const result = await runChat({
        messages,
        tools,
        signal,
        onDelta: (text) => this.emitEvent({ turnId, type: "delta", text }),
        onReasoning: (text) => this.emitEvent({ turnId, type: "reasoning", text })
      });
      if (result.usage) { this.emitEvent({ turnId, type: "usage", usage: result.usage }); }

      if (result.toolCalls.length) {
        messages.push({
          role: "assistant",
          content: result.content || null,
          tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } }))
        });
        for (const call of result.toolCalls) {
          this.emitEvent({ turnId, type: "tool_call", name: call.name, args: call.arguments });
          const output = await runTool(call.name, call.arguments);
          this.emitEvent({ turnId, type: "tool_result", name: call.name, content: output.slice(0, 4000) });
          messages.push({ role: "tool", tool_call_id: call.id, content: output.slice(0, 16000) });
        }
        continue;
      }

      this.emitEvent({ turnId, type: "done" });
      return;
    }
    this.emitEvent({ turnId, type: "delta", text: "\n\n（已达到最大工具调用轮数，回答可能不完整。）" });
    this.emitEvent({ turnId, type: "done" });
  }
}
