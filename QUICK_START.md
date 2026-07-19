# ⚡ Quick Start Guide

Get the Multi-Agent Money-Making System running in under 2 minutes.

## 🚀 Option 1: Try the Demo (Recommended First Step)
**Zero configuration - works immediately if you have Node.js**

```bash
# Clone and enter directory (if you haven't already)
git clone <repository-url>
cd free-money-1

# Install dependencies
npm install

# Run the 30-second demo (shows agents working, no auth needed)
node demo.js
```

**What you'll see:**
- Agents spawning and scanning for opportunities
- Real-time logging of discoveries
- Manager evaluating performance
- Survival-of-the-fittest in action
- Final statistics summary

## 🔧 Option 2: Full Setup (For Ongoing Use)

### 1. Basic Requirements
- [Node.js](https://nodejs.org/) (v18+)
- [MongoDB](https://www.mongodb.com/try/download/community) (optional - uses memory if not available)

### 2. Quick Setup
```bash
# Install dependencies
npm install

# Configure environment (copy template)
cp .env.example .env

# OPTIONAL: Edit .env if you want to customize ports, etc.
# (Defaults work fine for most cases)
```

### 3. Start the System
```bash
# Development mode (auto-restarts on changes)
npm run dev

# OR Production mode
node server.js
```

### 4. Get Your API Token
```bash
# In a NEW terminal window:
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}'
```

Copy the `"token"` value from the response (it's a long string starting with `eyJ...`).

### 5. Try the API
```bash
# Replace YOUR_TOKEN with the token from above
TOKEN="YOUR_TOKEN_HERE"

# See all agents
curl -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/agents

# Spawn a new crypto hunter
curl -X POST http://localhost:5000/api/agents/spawn \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"cryptoHunter","options":{"name":"My Hunter","config":{"scanInterval":30000}}}'

# See opportunities
curl -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/opportunities
```

## 💡 Pro Tips

- **First run**: The demo (`node demo.js`) is the fastest way to see everything work
- **No MongoDB?**: System automatically falls back to in-memory storage - perfect for testing
- **Default credentials**: `admin` / `password123` (change in .env for production)
- **Agent callbacks**: Check server logs to see agents working in real-time
- **Stop the system**: Press `Ctrl+C` in the terminal where it's running

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "MongoDB connection failed" | Ignore if using demo or first run - system works without MongoDB |
| "Port already in use" | Another process is on port 5000 - change PORT in .env or stop the other process |
| "Invalid token" | Get a fresh token from `/api/auth/login` (tokens expire in 7 days) |
| No agents showing | Wait 5-10 seconds after startup - agents spawn after server initializes |

## 📚 Need More Details?

See the full [README.md](README.md) for:
- Complete API documentation
- All configuration options
- Architecture details
- Deployment guide

---

**You're now ready!** 🎉  
Start with `node demo.js` to see the system in action, then explore the full API when you're ready to build your own integrations.