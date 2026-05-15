import type { Request, Response } from "express";
import { supabase } from "../env.mjs";

async function userIdForSandbox(sandboxId: string): Promise<string | null> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandboxId)
    .maybeSingle();
  if (error) throw error;
  return (data?.user_id as string) ?? null;
}

export async function handleListTasks(req: Request, res: Response) {
  try {
    const sandboxId = req.params.sandboxId as string;
    const userId = await userIdForSandbox(sandboxId);
    if (!userId) {
      res.json({ schedules: [] });
      return;
    }
    const { data, error } = await supabase!
      .from("schedules")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ schedules: data ?? [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleListTaskRuns(req: Request, res: Response) {
  try {
    const sandboxId = req.params.sandboxId as string;
    const scheduleId = req.params.scheduleId as string;
    const userId = await userIdForSandbox(sandboxId);
    if (!userId) {
      res.status(404).json({ error: "Sandbox owner not found" });
      return;
    }
    // Ensure the schedule belongs to this user before returning runs.
    const { data: sched, error: schedErr } = await supabase!
      .from("schedules")
      .select("id")
      .eq("id", scheduleId)
      .eq("user_id", userId)
      .maybeSingle();
    if (schedErr) throw schedErr;
    if (!sched) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    const limitRaw = req.query.limit;
    const limit = Math.max(
      1,
      Math.min(200, Number(limitRaw) || 50),
    );
    const { data, error } = await supabase!
      .from("schedule_runs")
      .select("*")
      .eq("schedule_id", scheduleId)
      .order("sent_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ runs: data ?? [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
