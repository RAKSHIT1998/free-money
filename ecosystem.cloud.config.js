// pm2 process definition for the CLOUD VM deployment — added 2026-09-02.
//
// Unlike ecosystem.config.js (used on a laptop, which runs the backend AND a
// separate `vite --port 3000` dev server as two processes), this file runs a single
// process. server.js now serves the built React dashboard directly
// (vite-react-ts-tailwind/dist) alongside the API on one port, so a production VM
// only needs one pm2 app, one open firewall port, and no CORS configuration between
// two services. Requires `npm run build` to have been run inside
// vite-react-ts-tailwind/ first (see DEPLOY.md) — server.js falls back to
// API-only (no dashboard) if dist/ doesn't exist, rather than erroring.
module.exports = {
  apps: [
    {
      name: 'free-money-backend',
      script: 'server.js',
      cwd: __dirname,
      env: { PORT: 5050 },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      max_restart_delay: 10000,
      exp_backoff_restart_delay: 100,
      out_file: 'pm2-backend.out.log',
      error_file: 'pm2-backend.err.log',
      merge_logs: true,
      time: true
    }
  ]
};
