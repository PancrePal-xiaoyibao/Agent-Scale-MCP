import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.AGENT_SCALE_API_URL || "http://localhost:3000";
const API_KEY = process.env.AGENT_SCALE_API_KEY || "";

async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }

  const res = await fetch(url, { ...options, headers });
  const body = await res.json();

  if (!res.ok) {
    const errorMsg =
      (body as { error?: string }).error || `HTTP ${res.status}`;
    throw new Error(errorMsg);
  }

  return body;
}

const sessionStore = new Set<string>();

const server = new McpServer({
  name: "agent-scale",
  version: "1.0.0",
});

// ── Tool: list_templates ───────────────────────────────────────────
server.tool(
  "list_templates",
  "获取所有可用的心理测评量表列表。返回量表名称、分类、题目数量和预估完成时间等摘要信息，用于向用户推荐合适的量表。",
  {},
  async () => {
    const data = await apiRequest("/api/v1/templates");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── Tool: get_template ─────────────────────────────────────────────
server.tool(
  "get_template",
  "获取指定量表的完整详情，包括所有题目、选项和评分规则。当需要了解量表具体内容或向用户解释量表时使用。",
  {
    slug: z
      .string()
      .describe("量表标识符，如 phq-9、gad-7、sss"),
  },
  async ({ slug }) => {
    const data = await apiRequest(`/api/v1/templates/${encodeURIComponent(slug)}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── Tool: create_session ───────────────────────────────────────────
server.tool(
  "create_session",
  "为用户创建一个心理测评会话，返回可分享的评测链接（assessment_url）。将链接发送给用户即可开始填写。",
  {
    template_slug: z
      .string()
      .describe("量表标识符，如 phq-9、gad-7、sss"),
    expires_in: z
      .number()
      .optional()
      .describe("会话过期时间（秒），默认 86400（24小时）"),
    callback_url: z
      .string()
      .url()
      .optional()
      .describe("Webhook 回调 URL，用户完成评测后系统会 POST 评分结果到此地址"),
  },
  async ({ template_slug, expires_in, callback_url }) => {
    const body: Record<string, unknown> = { template_slug };
    if (expires_in !== undefined) body.expires_in = expires_in;
    if (callback_url !== undefined) body.callback_url = callback_url;

    const data = (await apiRequest("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { session_id?: string };

    if (data.session_id) {
      sessionStore.add(data.session_id);
    }

    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── Tool: get_session ──────────────────────────────────────────────
server.tool(
  "get_session",
  "获取指定会话的状态和评测结果。当 status 为 completed 时，result 字段包含完整的评分结果（总分、风险等级、逐题明细）。这是获取用户评测结果的主要方式。",
  {
    session_id: z
      .string()
      .uuid()
      .describe("会话 ID"),
  },
  async ({ session_id }) => {
    if (!sessionStore.has(session_id)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "该 session_id 不属于当前会话，无法查询。只能查询通过 create_session 创建的会话。",
          },
        ],
      };
    }
    const data = await apiRequest(`/api/v1/sessions/${session_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── Start ──────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
