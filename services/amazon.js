const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

/**
 * Search Amazon products by scraping search results (no API needed)
 */
async function searchProducts(keywords, category, settings) {
  const partnerTag = settings.amazon?.partnerTag || '';
  const marketplace = settings.amazon?.marketplace || 'www.amazon.com';

  if (!partnerTag) {
    throw new Error('Amazon Associate Tag not configured. Go to Settings to add it (e.g. "yourname-20").');
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });

    // Build search URL
    const searchQuery = encodeURIComponent(keywords);
    const categoryParam = category && category !== 'All' ? `&i=${getCategorySlug(category)}` : '';
    const url = `https://${marketplace}/s?k=${searchQuery}${categoryParam}`;

    console.log(`[Amazon] Searching: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    // Extract product data from search results
    const products = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('[data-component-type="s-search-result"]');

      cards.forEach((card, index) => {
        if (index >= 10) return; // Limit to 10

        try {
          const asin = card.getAttribute('data-asin');
          if (!asin) return;

          // Title
          const titleEl = card.querySelector('h2 a span, h2 span');
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title) return;

          // Image
          const imgEl = card.querySelector('.s-image');
          const imageUrl = imgEl ? imgEl.getAttribute('src') : '';

          // Price
          const priceWhole = card.querySelector('.a-price .a-price-whole');
          const priceFraction = card.querySelector('.a-price .a-price-fraction');
          const priceSymbol = card.querySelector('.a-price .a-price-symbol');
          let price = '';
          if (priceWhole) {
            const symbol = priceSymbol ? priceSymbol.textContent : '$';
            const whole = priceWhole.textContent.replace(/[,\.]/g, '');
            const fraction = priceFraction ? priceFraction.textContent : '00';
            price = `${symbol}${whole}.${fraction}`;
          }

          // Original price (strikethrough)
          const origPriceEl = card.querySelector('.a-price.a-text-price .a-offscreen');
          const originalPrice = origPriceEl ? origPriceEl.textContent.trim() : null;

          // Rating
          const ratingEl = card.querySelector('.a-icon-alt');
          const rating = ratingEl ? ratingEl.textContent.trim() : '';

          // Brand — sometimes in a separate row
          const brandEl = card.querySelector('.a-size-base-plus.a-color-base, .a-row .a-size-base.a-color-secondary');
          const brand = brandEl ? brandEl.textContent.trim() : '';

          items.push({ asin, title, imageUrl, price, originalPrice, brand, rating });
        } catch (e) {
          // Skip malformed cards
        }
      });

      return items;
    });

    // Add affiliate links
    return products.map(p => ({
      ...p,
      affiliateLink: buildAffiliateLink(p.asin, partnerTag, marketplace),
      features: []
    }));
  } catch (err) {
    console.error('Amazon scrape error:', err);
    throw new Error(`Amazon search failed: ${err.message}`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

/**
 * Build an Amazon affiliate link from ASIN and tag
 */
function buildAffiliateLink(asin, tag, marketplace = 'www.amazon.com') {
  return `https://${marketplace}/dp/${asin}/ref=nosim?tag=${tag}`;
}

function getCategorySlug(category) {
  const map = {
    'Electronics': 'electronics',
    'Books': 'stripbooks',
    'Fashion': 'fashion',
    'HomeAndKitchen': 'garden',
    'Beauty': 'beauty',
    'Sports': 'sporting',
    'Toys': 'toys-and-games',
    'Garden': 'lawngarden',
    'HealthPersonalCare': 'hpc',
    'Automotive': 'automotive',
    'Software': 'software'
  };
  return map[category] || 'aps';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrape Amazon Best Sellers for a category — NO API NEEDED
 * Returns top trending products directly from Amazon's bestseller pages
 */
async function scrapeBestSellers(niche, settings) {
  const partnerTag = settings.amazon?.partnerTag || '';
  const marketplace = settings.amazon?.marketplace || 'www.amazon.com';

  if (!partnerTag) {
    throw new Error('Amazon Associate Tag not configured. Go to Settings to add it.');
  }

  const categoryMap = {
    'tech gadgets':      '/zgbs/electronics/',
    'electronics':       '/zgbs/electronics/',
    'home & kitchen':    '/zgbs/kitchen/',
    'home and kitchen':  '/zgbs/kitchen/',
    'beauty & skincare': '/zgbs/beauty/',
    'beauty':            '/zgbs/beauty/',
    'fitness & sports':  '/zgbs/sporting-goods/',
    'fitness':           '/zgbs/sporting-goods/',
    'sports':            '/zgbs/sporting-goods/',
    'pet products':      '/zgbs/pet-supplies/',
    'pets':              '/zgbs/pet-supplies/',
    'baby products':     '/zgbs/baby-products/',
    'baby':              '/zgbs/baby-products/',
    'office supplies':   '/zgbs/office-products/',
    'office':            '/zgbs/office-products/',
    'outdoor camping':   '/zgbs/sporting-goods/',
    'outdoor':           '/zgbs/sporting-goods/',
    'toys':              '/zgbs/toys-and-games/',
    'books':             '/zgbs/books/',
    'health':            '/zgbs/hpc/',
    'clothing':          '/zgbs/fashion/',
    'fashion':           '/zgbs/fashion/',
    'tools':             '/zgbs/hi/',
  };

  const nicheKey = niche.toLowerCase().trim();
  const bsPath = categoryMap[nicheKey] || '/zgbs/movers-and-shakers/';
  const url = `https://${marketplace}${bsPath}`;
  console.log(`[Amazon] Scraping Best Sellers: ${url}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2500);

    const products = await page.evaluate(() => {
      const items = [];
      const seen = new Set();

      const cards = document.querySelectorAll(
        '.zg-grid-general-faceout, .p13n-sc-uncoverable-faceout, .a-carousel-card'
      );

      cards.forEach((card) => {
        if (items.length >= 8) return;
        try {
          const titleEl = card.querySelector(
            '.p13n-sc-truncate-desktop-type2, .p13n-sc-truncated, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, a span, .a-truncate-cut'
          );
          const title = titleEl ? titleEl.textContent.trim() : '';
          if (!title || title.length < 5 || seen.has(title)) return;

          const linkEl = card.querySelector('a[href*="/dp/"]');
          const href = linkEl ? linkEl.getAttribute('href') : '';
          const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
          const asin = asinMatch ? asinMatch[1] : '';
          if (!asin) return;

          const imgEl = card.querySelector('img');
          const imageUrl = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';
          if (!imageUrl || imageUrl.includes('transparent')) return;

          const priceEl = card.querySelector('.p13n-sc-price, ._cDEzb_p13n-sc-price_3mJ9Z, .a-price span');
          const price = priceEl ? priceEl.textContent.trim() : '';

          const ratingEl = card.querySelector('.a-icon-alt, [aria-label*="stars"]');
          const rating = ratingEl ? ratingEl.textContent.trim() : '';

          const rankEl = card.querySelector('.zg-bdg-text, ._p13n-zg-badge-wrapper_bL2s3_7 span');
          const rank = rankEl ? parseInt(rankEl.textContent.replace('#', '')) || 99 : 99;

          seen.add(title);
          items.push({ asin, title, imageUrl, price, originalPrice: null, brand: '', rating, rank });
        } catch (e) { /* skip */ }
      });

      return items;
    });

    if (!products || products.length === 0) {
      console.log('[Amazon] Best sellers returned no products, falling back to keyword search...');
      const fallbackKeyword = getNicheKeywords(niche)[0] || niche;
      return searchProducts(fallbackKeyword, 'All', settings);
    }

    products.sort((a, b) => a.rank - b.rank);

    return products.slice(0, 8).map(p => ({
      ...p,
      affiliateLink: buildAffiliateLink(p.asin, partnerTag, marketplace),
      features: [],
      source: 'bestsellers'
    }));
  } catch (err) {
    console.error('[Amazon] Best sellers error:', err.message);
    const fallbackKeyword = getNicheKeywords(niche)[0] || niche;
    return searchProducts(fallbackKeyword, 'All', settings);
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

/**
 * Get curated trending keyword list for a niche — NO API NEEDED
 * These are proven high-converting product keywords for Pinterest affiliate marketing
 */
function getNicheKeywords(niche) {
  const keywordMap = {
    'tech gadgets': [
      'wireless earbuds bluetooth 2025', 'portable charger power bank', 'smart watch fitness tracker',
      'laptop stand adjustable', 'phone holder car mount', 'usb hub multiport', 'ring light selfie'
    ],
    'electronics': [
      'wireless earbuds', 'smart home device', 'portable bluetooth speaker',
      'led desk lamp', 'webcam hd', 'mechanical keyboard', 'gaming mouse'
    ],
    'home & kitchen': [
      'air fryer compact', 'coffee maker single serve', 'kitchen organizer drawer',
      'silicone cooking utensils set', 'water bottle insulated', 'cutting board bamboo large', 'instant pot accessories'
    ],
    'home and kitchen': [
      'air fryer', 'coffee maker', 'kitchen storage organizer', 'water filter pitcher', 'silicone baking mat'
    ],
    'beauty & skincare': [
      'vitamin c serum face', 'hyaluronic acid moisturizer', 'jade roller face massage',
      'retinol eye cream', 'sheet mask hydrating', 'lip gloss plumping', 'sunscreen spf 50'
    ],
    'beauty': [
      'facial serum vitamin c', 'electric face massager', 'makeup organizer acrylic', 'hair growth serum'
    ],
    'fitness & sports': [
      'resistance bands set', 'yoga mat non slip', 'jump rope speed', 'foam roller muscle',
      'water bottle gym', 'workout gloves', 'ankle weights'
    ],
    'fitness': [
      'resistance bands', 'yoga mat thick', 'dumbbells adjustable', 'ab wheel roller'
    ],
    'pet products': [
      'dog chew toys indestructible', 'cat tree tower condo', 'pet grooming brush',
      'dog training treats', 'automatic pet feeder', 'cat toy interactive', 'dog collar gps'
    ],
    'baby products': [
      'baby monitor video', 'diaper bag backpack', 'baby carrier wrap',
      'white noise machine baby', 'baby food maker', 'teething toys silicone', 'baby wipes sensitive'
    ],
    'office supplies': [
      'desk organizer bamboo', 'ergonomic mouse pad wrist', 'cable management box',
      'planner 2025 weekly', 'sticky notes multicolor', 'pen set gel ink', 'file folder organizer'
    ],
    'outdoor camping': [
      'camping lantern solar', 'water filter straw survival', 'hammock camping lightweight',
      'hiking backpack 50L', 'tent 2 person', 'sleeping bag mummy', 'fire starter flint'
    ],
    'outdoor': [
      'camping gear essentials', 'hiking poles trekking', 'outdoor blanket waterproof', 'solar charger panel'
    ],
    'toys': [
      'lego building set', 'stem toys kids', 'kinetic sand kit', 'slime kit girls',
      'board game family', 'rc car remote control', 'sensory toys autism'
    ],
    'fashion': [
      'crossbody bag women', 'scrunchie set hair', 'sunglasses polarized women',
      'belt leather men', 'socks funny novelty', 'tote bag canvas large'
    ],
    'health': [
      'vitamin d3 supplement', 'collagen peptides powder', 'probiotic 50 billion',
      'magnesium glycinate', 'melatonin sleep aid', 'fish oil omega 3', 'multivitamin women'
    ],
  };

  const key = niche.toLowerCase().trim();
  if (keywordMap[key]) return keywordMap[key];
  for (const [k, v] of Object.entries(keywordMap)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return [niche + ' best seller', niche + ' top rated', niche + ' popular 2025'];
}

module.exports = { searchProducts, buildAffiliateLink, scrapeBestSellers, getNicheKeywords };
