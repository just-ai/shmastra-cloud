const fs = require("fs");

// E2B injects sandbox envs (ANTHROPIC_API_KEY, CORS_ORIGIN, etc.) into the PM2
// daemon at sandbox creation time. PM2 does NOT pass its daemon env to child
// processes — children get only what's in this config's `env:` block. And when
// `pm2 reload` is invoked from a reconnected client, its shell has none of the
// sandbox envs (E2B's Sandbox.create envs are client-scoped, not persistent).
//
// So: read the daemon's own env directly from /proc and forward it here.
function readDaemonEnv() {
  try {
    const pidFile = `${process.env.HOME}/.pm2/pm2.pid`;
    const pid = fs.readFileSync(pidFile, "utf-8").trim();
    const raw = fs.readFileSync(`/proc/${pid}/environ`, "utf-8");
    const out = {};
    for (const kv of raw.split("\0")) {
      if (!kv) continue;
      const i = kv.indexOf("=");
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return out;
  } catch {
    return {};
  }
}
const daemonEnv = readDaemonEnv();

module.exports = {
  apps: [
    {
      name: "shmastra",
      script: "pnpm",
      args: "dev",
      cwd: "/home/user/shmastra",
      autorestart: true,
      max_restarts: 1,
      min_uptime: 10000,
      restart_delay: 2000,
      out_file: "/home/user/shmastra/.logs/shmastra.log",
      error_file: "/home/user/shmastra/.logs/shmastra.log",
      merge_logs: true,
      env: {
        ...daemonEnv,
        SHMASTRA_WORKDIR_HOME: "/home/user/workdir",
      },
    },
    {
      name: "healer",
      script: "/home/user/healer.cjs",
      cwd: "/home/user/shmastra",
      autorestart: true,
      out_file: "/home/user/shmastra/.logs/healer.log",
      error_file: "/home/user/shmastra/.logs/healer.log",
      merge_logs: true,
      env: daemonEnv,
    },
  ],
};
