module.exports = {
  apps: [
    {
      name: "shmastra",
      script: "pnpm",
      args: "dev",
      cwd: "/home/user/shmastra",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 2000,
      out_file: "/home/user/shmastra-out.log",
      error_file: "/home/user/shmastra-error.log",
      merge_logs: true,
    },
  ],
};
