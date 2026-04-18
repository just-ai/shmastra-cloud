import type { Request, Response } from "express";
import { MastraClient } from "@mastra/client-js";
import { Sandbox } from "e2b";
import { supabase } from "../env.mjs";

interface SandboxRow {
  sandbox_id: string;
  user: { virtual_key: string | null } | null;
}

async function getVirtualKey(sandboxId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("sandboxes")
    .select("sandbox_id, user:users(virtual_key)")
    .eq("sandbox_id", sandboxId)
    .single<SandboxRow>();
  if (error || !data) return null;
  return data.user?.virtual_key || null;
}

async function makeClient(sandboxId: string) {
  const virtualKey = await getVirtualKey(sandboxId);
  if (!virtualKey) throw new Error("Virtual key not found for this sandbox");
  const sandbox = await Sandbox.connect(sandboxId, { timeoutMs: 30_000 });
  const host = sandbox.getHost(4111);
  const baseUrl = host.startsWith("http") ? host : `https://${host}`;
  return new MastraClient({
    baseUrl,
    apiPrefix: "/api/mastra",
    headers: { Authorization: `Bearer ${virtualKey}` },
    retries: 0,
  });
}

export async function handleMastraStats(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  try {
    const client = await makeClient(sandboxId);
    const [agents, workflows, tools] = await Promise.all([
      client.listAgents().catch(() => ({})),
      client.listWorkflows().catch(() => ({})),
      client.listTools().catch(() => ({})),
    ]);

    const agentList = Object.entries(agents).map(([id, a]: [string, any]) => ({
      id, name: a.name || id, model: a.modelId || a.model || null,
    }));
    const workflowList = Object.entries(workflows).map(([id, w]: [string, any]) => ({
      id, name: w.name || id, steps: Array.isArray(w.steps) ? w.steps.length : (w.stepCount ?? null),
    }));
    const toolList = Object.entries(tools).map(([id, t]: [string, any]) => ({
      id, description: t.description || "",
    }));

    res.json({
      agents: { count: agentList.length, items: agentList },
      workflows: { count: workflowList.length, items: workflowList },
      tools: { count: toolList.length, items: toolList },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ── Observability ──

// Defensive extraction — Mastra/OTEL attributes use various shapes.
function extractTokens(attrs: any): { input: number; output: number } {
  if (!attrs) return { input: 0, output: 0 };
  const u = attrs.usage || attrs;
  const input = Number(
    u.inputTokens ?? u.promptTokens ?? attrs["gen_ai.usage.input_tokens"] ?? attrs["gen_ai.usage.prompt_tokens"] ?? 0,
  );
  const output = Number(
    u.outputTokens ?? u.completionTokens ?? attrs["gen_ai.usage.output_tokens"] ?? attrs["gen_ai.usage.completion_tokens"] ?? 0,
  );
  return { input: isNaN(input) ? 0 : input, output: isNaN(output) ? 0 : output };
}

function extractModel(attrs: any): string | null {
  if (!attrs) return null;
  return (
    attrs.model ?? attrs.modelId ?? attrs["llm.model"] ?? attrs["gen_ai.request.model"] ?? attrs["gen_ai.response.model"] ?? null
  );
}

function extractModelFromName(name: string | undefined): string | null {
  if (!name) return null;
  const m = name.match(/llm:\s*'([^']+)'/);
  return m ? m[1] : null;
}

export async function handleObservability(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 7);
  try {
    const client = await makeClient(sandboxId);

    const start = new Date(Date.now() - hours * 3600 * 1000);
    const end = new Date();

    const resp: any = await client.listTraces({
      filters: { startedAt: { start, end } },
      pagination: { page: 0, perPage: 100 },
      orderBy: { field: "startedAt", direction: "DESC" },
    }).catch((err: any) => ({ _err: err.message }));

    if (resp?._err) {
      res.status(500).json({ error: resp._err });
      return;
    }

    const topSpans: any[] = resp?.traces || resp?.spans || resp?.items || [];
    const recent: any[] = [];

    for (const t of topSpans) {
      if (recent.length >= 30) break;
      const agent = t.entityName || t.rootEntityName || t.attributes?.["agent.name"] || "—";
      const status = t.status || (t.error ? "error" : t.endedAt ? "success" : "running");
      const startedAt = t.startedAt ? new Date(t.startedAt).getTime() : null;
      const endedAt = t.endedAt ? new Date(t.endedAt).getTime() : null;
      const latency = startedAt && endedAt ? endedAt - startedAt : null;

      recent.push({
        traceId: t.traceId,
        time: t.startedAt,
        agent,
        model: null,
        input: 0, output: 0,
        latencyMs: latency,
        status,
      });
    }

    res.json({
      window: { hours, start, end },
      totals: { runs: topSpans.length, errors: recent.filter((r) => r.status === "error").length },
      recent,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleTraceDetail(req: Request, res: Response) {
  const sandboxId = req.params.sandboxId as string;
  const traceId = req.params.traceId as string;
  try {
    const client = await makeClient(sandboxId);
    const detail = await client.getTrace(traceId);
    const spans: any[] = detail?.spans || [];

    let input = 0, output = 0;
    let model: string | null = null;
    for (const s of spans) {
      const attrs = s.attributes || {};
      const { input: si, output: so } = extractTokens(attrs);
      input += si;
      output += so;
      if (!model) model = extractModel(attrs) || extractModelFromName(s.name);
    }

    res.json({ traceId, model, input, output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
