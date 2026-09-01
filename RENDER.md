# Deploying to Render

Simpler than Railway here — no auto-detection to fight with, you tell Render the
build/start commands directly. Same underlying code (the `node_modules` symlink fix,
the payment-service crash-loop fix, and single-port frontend+backend serving) already
on `main` carries over unchanged.

**Free tier will not work for this app** — Render's free web services sleep after 15
min without incoming HTTP traffic, which kills background agent loops (they run on
internal timers, nobody has to visit the URL to keep them alive). You need the
**Starter** plan (~$7/mo, always-on) at minimum.

---

## Already have a manually-created service that's misbehaving?

If you already went through "New → Web Service" by hand (not the Blueprint flow
below) and it's flip-flopping between working and Render's own "Not Found" page,
or `/` 404s — this repo now has a `render.yaml` that codifies the two settings that
caused that (Build Command, Health Check Path), but Render does **not** retroactively
apply a repo's `render.yaml` to a service that wasn't created from it. Two options:

- **Fastest**: manually fix the same two settings once — Settings → Build Command →
  `npm install && npm run build` → Save → **Manual Deploy → Deploy latest commit**;
  then Settings → Health Check Path → `/health` → Save.
- **Cleanest**: delete that service and follow "2. Create via Blueprint" below
  instead — it reads every setting from `render.yaml` automatically, so this class
  of drift can't happen again on a future recreate.

---

## 1. MongoDB Atlas (same as any host — do this first)

Render's disk is ephemeral per deploy just like Railway's, so the local JSON
ledger/position files would get wiped on every redeploy unless persistence points at
a real database. 5 minutes, free:

1. mongodb.com/cloud/atlas/register → sign up free → create a free **M0** cluster
2. **Database Access** → add a user + password
3. **Network Access** → Allow Access from Anywhere (`0.0.0.0/0`)
4. **Connect → Drivers** → copy the connection string, fill in your password — save
   it, you'll paste it into Render as `MONGODB_URI` below

---

## 2. Create via Blueprint (recommended — reads render.yaml automatically)

1. **render.com** → sign in with GitHub → **New → Blueprint**
2. Connect the `RAKSHIT1998/free-money` repo — Render detects `render.yaml` at the
   repo root and shows the `free-money-backend` service it defines (region:
   Frankfurt, plan: Starter, build/start commands, health check path — all pre-filled
   correctly, nothing to type).
3. Click through to create it. Instance type is already pinned to Starter in the
   blueprint (not Free — see above).

<details>
<summary>Prefer the manual flow instead?</summary>

**New → Web Service** → connect the repo → fill in Region: Frankfurt, Branch:
`main`, Runtime: Node, Build Command: `npm install && npm run build`, Start Command:
`node server.js`, Instance Type: Starter. You'll also want to set Health Check Path
to `/health` under Settings after creating it — the Blueprint flow above does this
for you automatically, which is why it's the recommended path.
</details>

---

## 3. Secrets

Scroll to **Environment Variables** on the same create-service page (or Service →
Environment afterward). Render has a bulk-paste option too: click **Add from .env**
and paste your filled-in `.env` content directly — same one-paste flow as Railway.

Two adjustments, same as before:
- **Don't set `PORT`** — Render assigns its own and injects it automatically; the
  app already reads `process.env.PORT`.
- **Set `MONGODB_URI`** to the Atlas connection string from step 1, and leave
  `PERSISTENCE_ENABLED` unset or `true`.

Click **Create Web Service** (or **Save, rebuild and deploy** if you added the
service first).

---

## 4. Verify

Render gives you a URL like `https://free-money-xxxx.onrender.com` — shown at the
top of the service page once deployed. Open it, confirm the dashboard loads, log in
the same way (`admin` / your password). Check `https://<that-url>/health` for
`{"status":"OK",...}`.

Build and runtime logs are both in the **Logs** tab — paste either here if something
doesn't come up clean, same as we did for Railway.

---

## 5. Stop running it on your laptop

Same rule as always — don't run this app in two places at once against the same
wallet/API keys. Once Render is confirmed working:

```bash
pm2 stop free-money-backend free-money-frontend
pm2 delete free-money-backend free-money-frontend
```

---

## Updating the code later

`git push` to `main` — Render auto-redeploys on every push to the connected branch,
same as Railway.

## If you already tried Railway

Nothing to undo on this repo's side — the code is identical either way. If you had
a Railway service running, you can just delete it from Railway's dashboard once
Render is confirmed working, so you're not paying for both.
