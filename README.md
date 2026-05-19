# Pinterest Auto Post — Netlify + Render.com Deployment Guide

## 🏗️ Architecture

```
Netlify (Frontend — Static)          Render.com (Backend — Node.js)
┌──────────────────────────┐         ┌──────────────────────────────┐
│  public/index.html       │  API    │  server.js (Express)         │
│  public/styles.css       │ ──────▶ │  services/amazon.js          │
│  public/app.js           │         │  services/pinterest.js       │
│                          │ ◀────── │  services/imageGenerator.js  │
│  [All tabs + UI]         │  SSE    │  services/gemini.js          │
└──────────────────────────┘         │  services/kieAi.js           │
                                     └──────────────────────────────┘
```

---

## 🚀 Step-by-Step Deployment

### Step 1 — Deploy Backend to Render.com

1. Push this repo to **GitHub** (make sure `settings.json` is in `.gitignore` ✅)
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
   - **Plan:** Free
5. Click **Deploy**
6. Wait ~2 minutes — copy your URL: `https://your-app-name.onrender.com`

> ⚠️ **Free tier note**: Render.com free services sleep after 15 min of inactivity. First request may take 30s to wake up. Upgrade to Starter ($7/mo) for always-on.

---

### Step 2 — Deploy Frontend to Netlify

#### Option A — Drag & Drop (Easiest)
1. Go to [netlify.com](https://netlify.com) → **Add new site → Deploy manually**
2. **Drag your `public/` folder** into the drop zone
3. Done! Netlify gives you a URL like `https://your-site.netlify.app`

#### Option B — From GitHub (Auto-deploys)
1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Connect your GitHub repo
3. Settings:
   - **Publish directory:** `public`
   - **Build command:** _(leave empty)_
4. Click **Deploy site**

---

### Step 3 — Connect Frontend to Backend

1. Open your Netlify URL
2. Go to **Settings** tab
3. Under **Backend Connection**, paste your Render.com URL:
   ```
   https://your-app-name.onrender.com
   ```
4. Click **🔍 Test** — you should see "✅ Connected"
5. Click **💾 Save Settings**

That's it! The app is now fully connected. 🎉

---

## ⚙️ Local Development

```bash
# Install dependencies
npm install

# Start the backend server (serves UI at localhost:3000)
npm start
```

When running locally, **leave the Backend URL field empty** in Settings — the app will use relative paths automatically.

---

## 📁 Project Structure

```
├── public/              # Netlify static frontend
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── services/            # Backend service modules
│   ├── amazon.js        # Amazon product search + scraping
│   ├── pinterest.js     # Puppeteer-based Pinterest automation
│   ├── imageGenerator.js# Sharp/SVG image generation
│   ├── gemini.js        # Gemini AI integration
│   ├── geminiWeb.js     # Gemini Web (browser automation)
│   ├── kieAi.js         # Kie.ai image API
│   └── settings.js      # Settings load/save (settings.json)
├── server.js            # Express backend
├── netlify.toml         # Netlify config (publish: public/)
├── render.yaml          # Render.com one-click deploy
└── package.json
```

---

## 🔑 API Keys Needed

| Service | Required? | Where to get |
|---------|-----------|-------------|
| Amazon Associate Tag | ✅ Yes (for affiliate links) | [affiliate-program.amazon.com](https://affiliate-program.amazon.com) |
| Pinterest Email + Password | ✅ Yes (for auto-posting) | Your Pinterest login |
| Gemini API Key | ⚠️ Optional (for AI images) | [aistudio.google.com](https://aistudio.google.com) — Free |
| Kie.ai API Key | ⚠️ Optional (for Kie.ai images) | [kie.ai](https://kie.ai) — Paid |

---

## ❓ Troubleshooting

**Backend shows "Unreachable"**
- Wait 30s if it's a cold start (free Render tier sleeps)
- Check the Render.com dashboard for deploy errors

**Auto pipeline not posting to Pinterest**
- Ensure Pinterest email + password are set in Settings
- Puppeteer needs to log in — make sure 2FA is disabled on your Pinterest account

**Images not loading after generation**
- Verify the Backend URL is set correctly (it prefixes image URLs)
- The Render.com free disk is ephemeral — images are lost on restart. Consider upgrading or using an S3 bucket.
