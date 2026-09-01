// pm2 process definitions for 24/7 operation — added 2026-09-01. Runs the backend
// (all the trading agents + the performance governor) and the dashboard frontend as
// real daemons, independent of any particular terminal session: they survive this
// shell closing, and pm2 auto-restarts either one if it crashes.
//
// This solves the SOFTWARE half of "24/7/365" — it does not and cannot solve the
// hardware half. If this machine sleeps, loses power, loses network, or reboots
// without `pm2 resurrect` running again, nothing here is running either, agents
// included. See the README note added alongside this file for what that actually
// requires (caffeinate / Energy Saver settings, or moving off this laptop entirely).
module.exports = {
  apps: [
    {
      name: 'free-money-backend',
      script: 'server.js',
      cwd: __dirname,
      env: { PORT: 5050 },
      autorestart: true,
      max_restarts: 50,
      // Backs off up to 10s between restarts instead of hot-looping a crash forever
      // (e.g. a real Binance/Solana outage) into thousands of restarts/log spam.
      restart_delay: 2000,
      max_restart_delay: 10000,
      exp_backoff_restart_delay: 100,
      out_file: 'pm2-backend.out.log',
      error_file: 'pm2-backend.err.log',
      merge_logs: true,
      time: true
    },
    {
      name: 'free-money-frontend',
      script: 'node_modules/.bin/vite',
      args: '--port 3000',
      cwd: __dirname + '/vite-react-ts-tailwind',
      env: { VITE_API_URL: 'http://localhost:5050/api' },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      out_file: '../pm2-frontend.out.log',
      error_file: '../pm2-frontend.err.log',
      merge_logs: true,
      time: true
    }
  ]
};
