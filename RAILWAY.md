# Deploying to Railway

Railway is simpler than a VM: no SSH, no firewall rules, no pm2 — you connect your
GitHub repo, paste in your secrets, and Railway builds, runs, and restarts the app
for you. It's **not free** (usage-based billing, roughly $5-10/mo for an app like
this running 24/7) — that's the tradeoff for the lower setup effort.

The code in this repo is already Railway-ready (`railway.json`, and `npm run build`
now builds the dashboard) — this doc is just the steps on Railway's side.

---

## 1. One thing that's different from a VM: persistence

A VM's disk sticks around forever. Railway's does **not** — every redeploy gives the
app a fresh, empty filesystem. This app currently keeps trade/position history in
local JSON files as a fallback, which would get wiped on every deploy on Railway —
recreating the exact "silently lost trade history" bug this session already fixed
five times over, just caused by the hosting platform instead of application code.

**Fix: use the app's built-in MongoDB support** (it's already fully wired — this is
a config flip, not new code). Takes about 5 minutes:

1. Go to https://www.mongodb.com/cloud/atlas/register, sign up free.
2. Create a free **M0** cluster (512MB, $0/mo forever).
3. **Database Access** → add a database user (username + password — pick a new
   password here, not one you reuse elsewhere).
4. **Network Access** → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`).
   Railway's outbound IP isn't fixed on the cheaper plans, so this is the practical
   setting here — the database user's password is what actually protects it.
5. **Connect** → Drivers → copy the connection string. It looks like:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Fill in your real password in place of `<password>`, and add a database name
   before the `?`, e.g. `.../money-maker?retryWrites=...`. Save this string — you'll
   paste it into Railway as `MONGODB_URI` in step 3 below.

---

## 2. Deploy the app

1. Go to https://railway.app, sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → pick `RAKSHIT1998/free-money`.
3. Railway auto-detects Node.js and reads `railway.json` in this repo, which tells
   it exactly how to build (`npm install && npm run build`, which also builds the
   dashboard) and run (`node server.js`) — you shouldn't need to change anything
   here.
4. Under **Settings → Networking**, click **Generate Domain**. This gives you a
   public HTTPS URL like `free-money-production-xxxx.up.railway.app` — no firewall
   rules to configure, Railway handles that.

---

## 3. Set your secrets

Open the service → **Variables** tab → click **Raw Editor**. Open your local `.env`
file, copy its entire contents, and paste the whole block in — Railway parses
`KEY=VALUE` lines directly, so this is one paste instead of adding ~90 variables by
hand.

Two changes to make **before or after** pasting:

- **Delete the `PORT=...` line entirely** (or don't paste it). Railway assigns its
  own port dynamically and injects it as `PORT` automatically — the app already
  reads `process.env.PORT` so this needs no code change, but a hardcoded `PORT=5050`
  in your pasted variables would fight with Railway's own assignment.
- **Add/replace `MONGODB_URI`** with the Atlas connection string from step 1, and
  make sure `PERSISTENCE_ENABLED` is either absent or set to `true` (not `false`) —
  it defaults to enabled, so simplest is to just delete that line if present.

Click **Deploy** (or it redeploys automatically on variable changes).

---

## 4. Verify

Open the Railway-generated domain in a browser — you should see the same dashboard,
running continuously with no laptop involved. Check the **Deployments** tab for
build/runtime logs if anything looks off (this is Railway's equivalent of the pm2
log files you're used to locally).

Log in the same way (`admin` / your password).

---

## 5. Stop running it on your laptop

Same warning as always: don't run this app in two places at once against the same
wallet/API keys. Once Railway is confirmed working:

```bash
pm2 stop free-money-backend free-money-frontend
pm2 delete free-money-backend free-money-frontend
```

Railway is now the only thing trading.

---

## Updating the code later

Just `git push` to `main` — Railway auto-redeploys on every push to the connected
branch. No SSH, no manual `git pull`.

## If you want to bring over your current local trade history

Optional — the fresh MongoDB Atlas cluster starts empty, so P&L history tracked
so far (real_pumpfun_trades.json, etc.) won't appear in the new deployment's numbers
unless imported. The wallet's actual on-chain balance is unaffected either way (that
lives on Solana/Binance, not in this app's database) — this only affects the
dashboard's historical P&L figures. Ask if you want help migrating this; it's a
one-time script, not something to do by hand.
