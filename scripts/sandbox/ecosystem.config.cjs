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
        SHMASTRA_WORKDIR_HOME: "/home/user/workdir",
      },
    },
    {
      name: "healer",
      script: "npx",
      args: "tsx /home/user/healer.mts",
      cwd: "/home/user/shmastra",
      autorestart: true,
      out_file: "/home/user/shmastra/.logs/healer.log",
      error_file: "/home/user/shmastra/.logs/healer.log",
      merge_logs: true,
    },
  ],
};
