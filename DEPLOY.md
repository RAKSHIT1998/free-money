# Deploying to Google Cloud (Always Free e2-micro VM)

This runs the whole app — backend + all trading agents + the dashboard — as one
process on a small VM that Google gives away free forever (not a trial), so it stays
up 24/7 without your laptop. Total monthly cost: **$0**, as long as you stay on the
e2-micro shape in an eligible region and standard (not SSD) persistent disk.

Everything below that needs *your* Google account, card, or SSH session is on you —
I can't do that part. Everything that's just code is already done in this repo.

---

## 1. Create the free VM

1. Go to https://console.cloud.google.com/ and sign in (or create a Google account).
2. Create a new project (top bar → "New Project"). Any name is fine.
3. It'll ask for a billing account / card. This is Google's identity verification —
   staying within the Always Free quota (below) means you are not charged. Set a
   budget alert at $1 if you want a safety net (Billing → Budgets & alerts).
4. Go to **Compute Engine → VM instances → Create Instance**.
5. Set these exactly (deviating from any of these can silently take you out of the
   free tier):
   - **Region**: `us-west1`, `us-central1`, or `us-east1` (must be one of these three)
   - **Machine type**: `e2-micro`
   - **Boot disk**: click "Change" → OS: Debian, Version: Debian 12 (bookworm) →
     Boot disk type: **Standard persistent disk** (not SSD/Balanced) → Size: 30 GB
   - Leave everything else default.
6. Under **Firewall**, check "Allow HTTP traffic" (this opens port 80, not what we
   need yet, but it's harmless to leave checked).
7. Click **Create**. Wait ~30s for it to boot. Note the **External IP** shown in the
   VM instances list — you'll use it to reach the dashboard.

### Open the app's port

1. Go to **VPC network → Firewall → Create Firewall Rule**.
2. Name: `allow-free-money-app`
3. Targets: All instances in the network (simplest) or use a target tag if you
   prefer to scope it.
4. Source IPv4 ranges: `0.0.0.0/0`
5. Protocols and ports: check **TCP**, enter `5050`
6. Create.

---

## 2. SSH in and install prerequisites

From the VM instances list, click the **SSH** button next to your instance — this
opens a browser-based terminal, no key setup needed. Then run:

```bash
sudo apt-get update
sudo apt-get install -y git

# Node 20 (the app requires >=18)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pm2, same process manager already used on the laptop
sudo npm install -g pm2

node -v   # sanity check: should print v20.x
```

---

## 3. Get the code onto the VM

```bash
git clone https://github.com/RAKSHIT1998/free-money.git
cd free-money/free-money   # adjust if your repo layout differs
npm install --omit=dev
cd vite-react-ts-tailwind
npm install
npm run build              # produces dist/ — server.js serves this automatically
cd ..
```

---

## 4. Set your real secrets on the VM

**Do this yourself, directly VM-to-laptop — never paste real keys into a chat with
me.** The easiest way with zero typing: in the SSH-in-browser window, click the
gear icon (⚙) top-right → **Upload file** → select your local `free-money/.env`.
It lands in your home directory; move it into place:

```bash
mv ~/.env ~/free-money/free-money/.env
```

If you'd rather keep local trade history/positions instead of starting fresh, also
upload and move these (optional, all in the project root):
`real_pumpfun_trades.json`, `pumpfun_open_position.json`,
`real_funding_arb_positions.json`, `culled_agents.json`,
`pumpfun_creator_reputation.json`, `real_transfer_arb_positions.json`.

Then double check the port matches the firewall rule you opened:

```bash
cd ~/free-money/free-money
grep PORT .env   # should be 5050, or add PORT=5050 if missing
```

---

## 5. Start it and make it survive reboots

```bash
pm2 start ecosystem.cloud.config.js
pm2 save
pm2 startup   # it will print ONE command starting with "sudo env PATH=..." — copy
              # that exact line, paste it, run it. This is what makes pm2 (and your
              # agents) come back automatically if the VM ever reboots.
```

---

## 6. Verify

From your laptop (or anywhere):

```bash
curl http://<VM_EXTERNAL_IP>:5050/health
```

Should return `{"status":"OK",...}`. Then open `http://<VM_EXTERNAL_IP>:5050` in a
browser — that's the same dashboard, now running 24/7 in the cloud. Log in the same
way (`admin` / your password).

---

## 7. Stop running it on your laptop

**Important**: don't run this app in two places at once against the same wallet/API
keys — two instances both trying to buy/sell from the same Solana wallet or Binance
account at the same time is a real risk (races, duplicate orders, confusing state).
Once the VM is confirmed working:

```bash
# on your laptop
pm2 stop free-money-backend free-money-frontend
pm2 delete free-money-backend free-money-frontend
```

The VM is now the only thing trading.

---

## Updating the code later

```bash
# SSH into the VM
cd ~/free-money/free-money
git pull
npm install --omit=dev
cd vite-react-ts-tailwind && npm install && npm run build && cd ..
pm2 restart free-money-backend
```

## Optional: extra durability with MongoDB Atlas (free)

The VM's disk persists across app restarts and reboots on its own, so this isn't
required — but if you want off-VM backup of trade history (e.g. survives you
deleting/recreating the VM by mistake), sign up for MongoDB Atlas's free M0 tier,
create a cluster, and set in `.env`:

```
PERSISTENCE_ENABLED=true
MONGODB_URI=<your Atlas connection string>
```

This app already fully supports this — it's a config flip, not new code.
