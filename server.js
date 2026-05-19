const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { loadSettings, saveSettings } = require('./services/settings');
const { searchProducts } = require('./services/amazon');
const { generatePinImage } = require('./services/imageGenerator');
const { postToPin, setStatusCallback } = require('./services/pinterest');
const { discoverProducts, generatePinImageWithGemini } = require('./services/gemini');
const { scrapeBestSellers, getNicheKeywords } = require('./services/amazon');
const { generateImageViaGeminiWeb, setStatusCallback: setGeminiWebCallback } = require('./services/geminiWeb');

const app = express();
// Use PORT from environment (Render.com sets this automatically) or fall back to 3000
const PORT = process.env.PORT || 3000;

// Middleware — allow all origins so Netlify frontend can call this backend
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/generated', express.static(path.join(__dirname, 'generated')));

// Ensure generated directory exists
const generatedDir = path.join(__dirname, 'generated');
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

// ========================
// API Routes
// ========================

// --- Health Check (used by frontend to verify backend is alive) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});


// --- Settings ---
app.get('/api/settings', (req, res) => {
  try {
    const settings = loadSettings();
    // Mask sensitive fields for display
    const masked = JSON.parse(JSON.stringify(settings));
    if (masked.amazon && masked.amazon.secretKey) {
      masked.amazon.secretKey = maskString(masked.amazon.secretKey);
    }
    if (masked.pinterest && masked.pinterest.password) {
      masked.pinterest.password = maskString(masked.pinterest.password);
    }
    if (masked.kieAi && masked.kieAi.apiKey) {
      masked.kieAi.apiKey = maskString(masked.kieAi.apiKey);
    }
    res.json({ success: true, settings: masked, raw: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { settings } = req.body;
    const result = saveSettings(settings);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Amazon Search ---
app.post('/api/amazon/search', async (req, res) => {
  try {
    const { keywords, category } = req.body;
    const settings = loadSettings();

    if (!keywords) {
      return res.status(400).json({ success: false, error: 'Keywords are required' });
    }

    const products = await searchProducts(keywords, category, settings);
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Image Generation ---
app.post('/api/image/generate', async (req, res) => {
  try {
    const { product } = req.body;
    const settings = loadSettings();

    if (!product || !product.imageUrl) {
      return res.status(400).json({ success: false, error: 'Product with image URL is required' });
    }

    // Pass gemini & kieAi settings along so AI modes can use them
    const imageSettings = {
      ...settings.image,
      _gemini: settings.gemini,
      _settings: settings
    };

    const result = await generatePinImage(product, imageSettings);
    res.json({
      success: true,
      filename: result.filename,
      imageUrl: `/generated/${result.filename}`,
      outputPath: result.outputPath
    });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Gemini Product Discovery ---
app.post('/api/discover', async (req, res) => {
  try {
    const { niche } = req.body;
    const settings = loadSettings();

    if (!niche) {
      return res.status(400).json({ success: false, error: 'Niche is required' });
    }

    const suggestions = await discoverProducts(niche, settings);
    res.json({ success: true, suggestions });
  } catch (err) {
    console.error('Discover error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Gemini AI Image Generation ---
app.post('/api/image/generate-ai', async (req, res) => {
  try {
    const { product } = req.body;
    const settings = loadSettings();

    if (!product) {
      return res.status(400).json({ success: false, error: 'Product data is required' });
    }

    const result = await generatePinImageWithGemini(product, settings);
    res.json({
      success: true,
      filename: result.filename,
      imageUrl: `/generated/${result.filename}`,
      outputPath: result.outputPath
    });
  } catch (err) {
    console.error('AI image generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Gemini Web Image Generation (opens gemini.google.com, no API key needed) ---
app.post('/api/image/generate-gemini-web', async (req, res) => {
  try {
    const { product } = req.body;
    if (!product) {
      return res.status(400).json({ success: false, error: 'Product data is required' });
    }

    const productName = product.title || 'product';
    const price = product.price ? ` priced at ${product.price}` : '';
    const brand = product.brand ? ` by ${product.brand}` : '';

    const prompt = `Generate a Pinterest promotional image for this Amazon product:

Product: ${productName}${brand}${price}

Make it:
- Portrait orientation (tall, like 2:3 ratio)
- Vibrant, eye-catching gradient background (purple to cyan)
- Bold product title text at the top
- Clean white CTA button "Shop Now on Amazon" at the bottom
- Price badge if price available
- Professional product photography style
- "★ TRENDING ON AMAZON ★" banner at the very top
- Modern, premium Pinterest pin aesthetic that drives clicks`;

    setGeminiWebCallback((status) => broadcastStatus(status));
    const result = await generateImageViaGeminiWeb(prompt);
    res.json({
      success: true,
      filename: result.filename,
      imageUrl: result.imageUrl,
      outputPath: result.outputPath
    });
  } catch (err) {
    console.error('Gemini Web image error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Pinterest SSE Status Stream ---
let sseClients = [];

app.get('/api/pinterest/status', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

function broadcastStatus(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    client.write(message);
  });
}

// --- Pinterest Post ---
app.post('/api/pinterest/post', async (req, res) => {
  try {
    const { imagePath, title, description, link, board } = req.body;
    const settings = loadSettings();

    if (!imagePath) {
      return res.status(400).json({ success: false, error: 'Image path is required' });
    }

    // Set up status callback for real-time updates
    setStatusCallback((status) => {
      broadcastStatus(status);
    });

    const result = await postToPin(settings, {
      imagePath,
      title: title || '',
      description: description || '',
      link: link || '',
      board: board || ''
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Pinterest post error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Auto Pipeline (Discover → Search → Generate → Post) ---
// Works WITHOUT Gemini API key — falls back to Best Sellers scraping + Classic image generator
app.post('/api/auto/run', async (req, res) => {
  try {
    const { niche, postsPerRun, imageMode: reqImageMode } = req.body;
    const settings = loadSettings();

    // Only Pinterest + Amazon credentials are required — Gemini is optional
    if (!settings.pinterest?.email || !settings.pinterest?.password) {
      return res.status(400).json({ success: false, error: 'Pinterest credentials not configured. Go to Settings.' });
    }
    if (!settings.amazon?.partnerTag) {
      return res.status(400).json({ success: false, error: 'Amazon Associate Tag not configured. Go to Settings.' });
    }

    const targetNiche = niche || settings.autoMode?.niche || 'tech gadgets';
    const count = Math.min(parseInt(postsPerRun) || 1, 5);
    const useGemini = !!(settings.gemini?.apiKey);
    const imageMode = reqImageMode || settings.image?.mode || 'classic'; // 'classic', 'ai', 'gemini-web', 'kie-ai'

    // Run the auto pipeline asynchronously
    runAutoPipeline(targetNiche, count, settings, useGemini, imageMode).catch(err => {
      console.error('[Auto] Pipeline error:', err.message);
      broadcastStatus({ message: `Pipeline error: ${err.message}`, type: 'error' });
    });

    let modeLabel;
    if (imageMode === 'kie-ai') modeLabel = '🤖 Kie.ai Mode';
    else if (imageMode === 'gemini-web') modeLabel = '🌐 Gemini Web Mode';
    else if (useGemini) modeLabel = '✨ Gemini AI Mode';
    else modeLabel = '🔧 No-API Mode';
    res.json({ success: true, message: `Auto pipeline started | ${modeLabel} | Niche: ${targetNiche}` });
  } catch (err) {
    console.error('Auto run error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function runAutoPipeline(niche, count, settings, useGemini = false, imageMode = 'classic') {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const { generatePinImage } = require('./services/imageGenerator');

  let modeLabel;
  if (imageMode === 'kie-ai') modeLabel = '🤖 Kie.ai Mode';
  else if (imageMode === 'gemini-web') modeLabel = '🌐 Gemini Web Mode';
  else if (useGemini) modeLabel = '✨ Gemini AI Mode';
  else modeLabel = '🔧 No-API Mode';

  broadcastStatus({ message: `🤖 Auto pipeline starting | ${modeLabel} | Niche: "${niche}"`, type: 'info' });
  if (imageMode === 'kie-ai') {
    broadcastStatus({ message: '🤖 Image mode: Kie.ai Seedream API → AI-generated Pinterest image', type: 'info' });
  } else if (imageMode === 'gemini-web') {
    broadcastStatus({ message: '🌐 Image mode: Opens gemini.google.com → sends prompt → downloads image', type: 'info' });
  }

  // ============================
  // STEP 1: Product Discovery
  // ============================
  let productSlots = []; // Array of { keyword, pinTitle, pinDescription, products[] }

  if (useGemini) {
    // --- Gemini AI discovery ---
    broadcastStatus({ message: '🔍 Asking Gemini AI for trending product ideas...', type: 'info' });
    try {
      const suggestions = await discoverProducts(niche, settings);
      broadcastStatus({ message: `✓ Gemini found ${suggestions.length} product ideas`, type: 'success' });

      for (const s of suggestions.slice(0, count + 2)) {
        productSlots.push({
          keyword: s.keyword,
          category: s.category || 'All',
          pinTitle: s.pinTitle || '',
          pinDescription: s.pinDescription || '',
          imagePrompt: s.imagePrompt || ''
        });
      }
    } catch (err) {
      broadcastStatus({ message: `⚠ Gemini discovery failed (${err.message}), falling back to No-API mode...`, type: 'warning' });
      useGemini = false; // fall through to no-api
    }
  }

  if (!useGemini) {
    // --- No-API: scrape Amazon Best Sellers + curated keywords ---
    broadcastStatus({ message: '📈 Scraping Amazon Best Sellers for trending products...', type: 'info' });
    try {
      const bsProducts = await scrapeBestSellers(niche, settings);
      if (bsProducts && bsProducts.length > 0) {
        broadcastStatus({ message: `✓ Found ${bsProducts.length} best-selling products from Amazon`, type: 'success' });
        // Each bestseller product becomes its own post slot (no keyword search needed)
        for (const p of bsProducts.slice(0, count + 2)) {
          productSlots.push({
            directProduct: p, // skip search step
            keyword: p.title?.split(' ').slice(0, 4).join(' ') || niche,
            pinTitle: (p.title || '').substring(0, 100),
            pinDescription: `🔥 Trending on Amazon! ${p.price ? 'Only ' + p.price : ''} \n\n${p.title}\n\n🛒 Shop now with my affiliate link! #AmazonFinds #${niche.replace(/\s+/g,'').replace(/[^a-zA-Z0-9]/g,'')} #BestSeller`,
            imagePrompt: ''
          });
        }
      } else {
        throw new Error('No best sellers found');
      }
    } catch (err) {
      broadcastStatus({ message: `⚠ Best sellers scrape failed (${err.message}), using curated keywords...`, type: 'warning' });
      // Final fallback: use curated keyword list
      const keywords = getNicheKeywords(niche);
      broadcastStatus({ message: `✓ Using ${keywords.length} curated trending keywords for "${niche}"`, type: 'success' });
      for (const kw of keywords.slice(0, count + 2)) {
        productSlots.push({
          keyword: kw,
          category: 'All',
          pinTitle: '',  // will be filled from product
          pinDescription: '',
          imagePrompt: ''
        });
      }
    }
  }

  // ============================
  // STEP 2+: Per-post pipeline
  // ============================
  let posted = 0;

  for (let i = 0; i < productSlots.length && posted < count; i++) {
    const slot = productSlots[i];
    broadcastStatus({ message: `\n─── Post ${posted + 1}/${count} ───`, type: 'info' });

    // --- Find product ---
    let product = slot.directProduct || null;

    if (!product) {
      broadcastStatus({ message: `🛒 Searching Amazon for: "${slot.keyword}"`, type: 'info' });
      try {
        const results = await searchProducts(slot.keyword, slot.category || 'All', settings);
        product = (results || []).find(p => p.imageUrl && p.price) || (results || [])[0];
        if (!product) {
          broadcastStatus({ message: `⚠ No products found for "${slot.keyword}", skipping...`, type: 'warning' });
          continue;
        }
        broadcastStatus({ message: `✓ Found product: ${product.title?.substring(0, 55)}...`, type: 'success' });
      } catch (err) {
        broadcastStatus({ message: `⚠ Amazon search failed: ${err.message}`, type: 'warning' });
        continue;
      }
    } else {
      broadcastStatus({ message: `✓ Best seller: ${product.title?.substring(0, 55)}...`, type: 'success' });
    }

    if (slot.imagePrompt) product.imagePrompt = slot.imagePrompt;

    // Auto-generate pin title/description if empty
    const pinTitle = slot.pinTitle || product.title?.substring(0, 100) || niche;
    const pinDescription = slot.pinDescription ||
      `🔥 ${product.title}\n\n${product.price ? '💰 Price: ' + product.price : ''}\n\n🛒 Shop now! #AmazonFinds #${niche.replace(/[^a-zA-Z0-9]/g,'')} #OnlineShopping #Deals`;

    // --- Generate image (4 strategies) ---
    let imageResult;

    if (imageMode === 'kie-ai') {
      // Strategy 1: Kie.ai Market API (Seedream model)
      broadcastStatus({ message: '🤖 Generating image with Kie.ai Seedream API...', type: 'info' });
      try {
        const { generateImageWithKieAi } = require('./services/kieAi');
        imageResult = await generateImageWithKieAi(product, settings);
        broadcastStatus({ message: '✓ Kie.ai image generated!', type: 'success' });
      } catch (err) {
        broadcastStatus({ message: `⚠ Kie.ai image failed: ${err.message}\n  Falling back to Classic image...`, type: 'warning' });
        imageResult = null;
      }
    } else if (imageMode === 'gemini-web') {
      // Strategy 2: Open Gemini website and generate image
      broadcastStatus({ message: '🌐 Opening Gemini website to generate image...', type: 'info' });
      const productName = product.title || niche;
      const price = product.price ? ` priced at ${product.price}` : '';
      const geminiPrompt = `Generate a Pinterest promotional image for this Amazon product:\n\nProduct: ${productName}${price}\n\nMake it:\n- Portrait/tall orientation (2:3 ratio like a Pinterest pin)\n- Vibrant gradient background (purple to cyan)\n- Bold product title text\n- \"Shop Now on Amazon\" CTA button at the bottom\n${product.price ? '- Price badge: ' + product.price + '\n' : ''}- \"\u2605 TRENDING ON AMAZON \u2605\" banner at top\n- Professional, eye-catching, modern design`;
      try {
        setGeminiWebCallback((status) => broadcastStatus(status));
        imageResult = await generateImageViaGeminiWeb(geminiPrompt);
        broadcastStatus({ message: '✓ Gemini web image generated!', type: 'success' });
      } catch (err) {
        broadcastStatus({ message: `⚠ Gemini web image failed: ${err.message}\n  Falling back to Classic image...`, type: 'warning' });
        imageResult = null;
      }
    } else if (useGemini) {
      // Strategy 3: Gemini API image generation
      broadcastStatus({ message: '🎨 Generating image with Gemini AI API...', type: 'info' });
      try {
        imageResult = await generatePinImageWithGemini(product, settings);
        broadcastStatus({ message: '✓ AI image generated!', type: 'success' });
      } catch (err) {
        broadcastStatus({ message: `⚠ AI image failed, using Classic... (${err.message})`, type: 'warning' });
        imageResult = null;
      }
    }

    if (!imageResult) {
      // Strategy 3 (fallback): Classic Sharp/SVG image generator
      broadcastStatus({ message: '🖼️ Generating Classic Pinterest image...', type: 'info' });
      try {
        const imageSettings = { ...settings.image, mode: 'classic', _gemini: settings.gemini };
        imageResult = await generatePinImage(product, imageSettings);
        broadcastStatus({ message: '✓ Classic image generated!', type: 'success' });
      } catch (err) {
        broadcastStatus({ message: `✗ Image generation failed: ${err.message}`, type: 'error' });
        continue;
      }
    }

    // --- Post to Pinterest ---
    broadcastStatus({ message: '📌 Posting to Pinterest...', type: 'info' });
    try {
      setStatusCallback((status) => broadcastStatus(status));
      await postToPin(settings, {
        imagePath: imageResult.outputPath,
        title: pinTitle,
        description: pinDescription,
        link: product.affiliateLink || '',
        board: settings.pinterest?.defaultBoard || ''
      });
      broadcastStatus({ message: `✅ Post ${posted + 1} published! 🎉`, type: 'success' });
      broadcastStatus({ message: `   📌 "${pinTitle}"`, type: 'info' });
      posted++;
    } catch (err) {
      broadcastStatus({ message: `✗ Pinterest post failed: ${err.message}`, type: 'error' });
    }

    // Delay between posts
    if (posted < count && i < productSlots.length - 1) {
      const waitSec = settings.autoMode?.delayBetweenPosts || 30;
      broadcastStatus({ message: `⏳ Waiting ${waitSec}s before next post...`, type: 'info' });
      await delay(waitSec * 1000);
    }
  }

  broadcastStatus({
    message: `\n🎉 Auto pipeline complete! ${posted}/${count} pins posted successfully.`,
    type: posted > 0 ? 'success' : 'error'
  });
}

// --- Serve index.html for all other routes ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================
// Start Server
// ========================
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   📌 Pinterest Auto Post                    ║');
  console.log('  ║   Amazon Affiliate → Pinterest Automation   ║');
  console.log(`  ║   Running at: http://0.0.0.0:${PORT}            ║`);
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});

function maskString(str) {
  if (!str || str.length <= 6) return '••••••';
  return str.substring(0, 3) + '•'.repeat(str.length - 6) + str.substring(str.length - 3);
}
