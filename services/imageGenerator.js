const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { generatePinImageWithGemini } = require('./gemini');
const { generateImageWithKieAi } = require('./kieAi');

const GENERATED_DIR = path.join(__dirname, '..', 'generated');

// Ensure output directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * Generate a Pinterest-optimized product image.
 * Routes to the correct generator based on imageSettings.mode:
 *   'kie-ai'     → Kie.ai Market API (Seedream model)
 *   'ai'         → Gemini API
 *   'classic'    → Sharp/SVG template
 */
async function generatePinImage(product, imageSettings = {}) {
  // Route to Kie.ai if mode is 'kie-ai'
  if (imageSettings.mode === 'kie-ai') {
    // imageSettings._settings should be the full settings object
    const fullSettings = imageSettings._settings || {};
    return generateImageWithKieAi(product, fullSettings);
  }

  // Route to Gemini AI if mode is set to 'ai'
  if (imageSettings.mode === 'ai') {
    // Build a merged settings object that gemini.js expects
    const fakeSettings = {
      gemini: imageSettings._gemini || {}
    };
    return generatePinImageWithGemini(product, fakeSettings);
  }

  return generatePinImageClassic(product, imageSettings);
}


/**
 * Classic Sharp/SVG-based Pinterest image generator (1000x1500)
 */
async function generatePinImageClassic(product, imageSettings = {}) {
  const WIDTH = 1000;
  const HEIGHT = 1500;
  const PADDING = 60;

  const gradientStart = imageSettings.gradientStart || '#7c3aed';
  const gradientEnd = imageSettings.gradientEnd || '#06b6d4';
  const ctaText = imageSettings.ctaText || 'Shop Now on Amazon';
  const showPrice = imageSettings.showPrice !== false;

  // Download product image from Amazon
  let productImageBuffer;
  try {
    const response = await axios.get(product.imageUrl, { responseType: 'arraybuffer' });
    productImageBuffer = Buffer.from(response.data);
  } catch (err) {
    console.error('Failed to download product image:', err.message);
    // Create a placeholder if download fails
    productImageBuffer = await sharp({
      create: { width: 400, height: 400, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } }
    }).png().toBuffer();
  }

  // Get product image dimensions and resize to fit
  const productMeta = await sharp(productImageBuffer).metadata();
  const maxProductWidth = WIDTH - (PADDING * 2) - 40;
  const maxProductHeight = 700;

  const productResized = await sharp(productImageBuffer)
    .resize({
      width: maxProductWidth,
      height: maxProductHeight,
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  const resizedMeta = await sharp(productResized).metadata();
  const productLeft = Math.round((WIDTH - resizedMeta.width) / 2);
  const productTop = 180;

  // Truncate title to fit
  const title = truncateText(product.title, 80);
  const titleLines = wrapText(title, 30);
  const priceText = product.price || '';
  const originalPriceText = product.originalPrice || '';
  const brandText = product.brand || '';

  // Build SVG overlay with all text elements
  const titleSvg = buildTitleSvg(titleLines, WIDTH, productTop + resizedMeta.height + 40);
  const titleSvgBuffer = Buffer.from(titleSvg);

  // Price badge SVG
  const priceSvg = showPrice ? buildPriceSvg(priceText, originalPriceText, WIDTH) : null;
  const priceSvgBuffer = priceSvg ? Buffer.from(priceSvg) : null;

  // Brand SVG
  const brandSvg = brandText ? buildBrandSvg(brandText, WIDTH) : null;
  const brandSvgBuffer = brandSvg ? Buffer.from(brandSvg) : null;

  // CTA SVG
  const ctaSvg = buildCtaSvg(ctaText, WIDTH, HEIGHT);
  const ctaSvgBuffer = Buffer.from(ctaSvg);

  // Top badge SVG
  const topBadgeSvg = buildTopBadgeSvg(WIDTH);
  const topBadgeSvgBuffer = Buffer.from(topBadgeSvg);

  // Background gradient SVG
  const bgSvg = `
    <svg width="${WIDTH}" height="${HEIGHT}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${gradientStart};stop-opacity:0.15"/>
          <stop offset="100%" style="stop-color:${gradientEnd};stop-opacity:0.15"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    </svg>
  `;
  const bgSvgBuffer = Buffer.from(bgSvg);

  // White card area for product
  const cardSvg = `
    <svg width="${WIDTH}" height="${HEIGHT}">
      <rect x="${PADDING - 10}" y="${productTop - 30}" 
            width="${WIDTH - (PADDING * 2) + 20}" height="${resizedMeta.height + 60}" 
            rx="20" fill="white" fill-opacity="0.95"/>
    </svg>
  `;
  const cardSvgBuffer = Buffer.from(cardSvg);

  // Shadow under product card
  const shadowSvg = `
    <svg width="${WIDTH}" height="${HEIGHT}">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="8" stdDeviation="20" flood-color="#000" flood-opacity="0.1"/>
        </filter>
      </defs>
      <rect x="${PADDING}" y="${productTop - 20}" 
            width="${WIDTH - (PADDING * 2)}" height="${resizedMeta.height + 40}" 
            rx="16" fill="white" filter="url(#shadow)"/>
    </svg>
  `;
  const shadowSvgBuffer = Buffer.from(shadowSvg);

  // Compose all layers
  const composites = [
    { input: bgSvgBuffer, top: 0, left: 0 },
    { input: shadowSvgBuffer, top: 0, left: 0 },
    { input: cardSvgBuffer, top: 0, left: 0 },
    { input: productResized, top: productTop, left: productLeft },
    { input: topBadgeSvgBuffer, top: 0, left: 0 },
    { input: titleSvgBuffer, top: 0, left: 0 },
    { input: ctaSvgBuffer, top: 0, left: 0 }
  ];

  if (priceSvgBuffer) {
    composites.push({ input: priceSvgBuffer, top: 0, left: 0 });
  }

  if (brandSvgBuffer) {
    composites.push({ input: brandSvgBuffer, top: 0, left: 0 });
  }

  const filename = `pin-${Date.now()}.jpg`;
  const outputPath = path.join(GENERATED_DIR, filename);

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return { filename, outputPath };
}

function buildTopBadgeSvg(width) {
  return `
    <svg width="${width}" height="120">
      <defs>
        <linearGradient id="topGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#7c3aed;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#06b6d4;stop-opacity:1"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="100" fill="url(#topGrad)"/>
      <text x="${width / 2}" y="58" font-family="Arial, Helvetica, sans-serif" 
            font-size="28" font-weight="bold" fill="white" text-anchor="middle" 
            letter-spacing="3">★ TRENDING ON AMAZON ★</text>
    </svg>
  `;
}

function buildTitleSvg(lines, width, startY) {
  const lineHeight = 48;
  const textElements = lines.map((line, i) => {
    const escaped = escapeXml(line);
    return `<text x="${width / 2}" y="${startY + (i * lineHeight)}" 
            font-family="Arial, Helvetica, sans-serif" font-size="36" 
            font-weight="bold" fill="#1a1a2e" text-anchor="middle">${escaped}</text>`;
  }).join('');

  return `<svg width="${width}" height="1500">${textElements}</svg>`;
}

function buildPriceSvg(price, originalPrice, width) {
  const y = 1220;
  let svgContent = '';

  if (originalPrice && originalPrice !== price) {
    // Show both prices with strikethrough
    svgContent = `
      <rect x="${width / 2 - 180}" y="${y - 45}" width="360" height="70" rx="35" fill="#ef4444"/>
      <text x="${width / 2 - 40}" y="${y}" font-family="Arial, Helvetica, sans-serif" 
            font-size="40" font-weight="bold" fill="white" text-anchor="middle">${escapeXml(price)}</text>
      <text x="${width / 2 + 110}" y="${y - 5}" font-family="Arial, Helvetica, sans-serif" 
            font-size="24" fill="#fecaca" text-anchor="middle" 
            text-decoration="line-through">${escapeXml(originalPrice)}</text>
    `;
  } else {
    svgContent = `
      <rect x="${width / 2 - 120}" y="${y - 45}" width="240" height="70" rx="35" fill="#ef4444"/>
      <text x="${width / 2}" y="${y}" font-family="Arial, Helvetica, sans-serif" 
            font-size="40" font-weight="bold" fill="white" text-anchor="middle">${escapeXml(price)}</text>
    `;
  }

  return `<svg width="${width}" height="1500">${svgContent}</svg>`;
}

function buildBrandSvg(brand, width) {
  return `
    <svg width="${width}" height="1500">
      <text x="${width / 2}" y="145" font-family="Arial, Helvetica, sans-serif" 
            font-size="22" fill="#6b7280" text-anchor="middle" 
            letter-spacing="1">by ${escapeXml(brand)}</text>
    </svg>
  `;
}

function buildCtaSvg(text, width, height) {
  const y = height - 100;
  return `
    <svg width="${width}" height="${height}">
      <defs>
        <linearGradient id="ctaGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#7c3aed;stop-opacity:1"/>
          <stop offset="50%" style="stop-color:#2563eb;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#06b6d4;stop-opacity:1"/>
        </linearGradient>
      </defs>
      <rect x="${width / 2 - 220}" y="${y - 35}" width="440" height="65" rx="32" fill="url(#ctaGrad)"/>
      <text x="${width / 2}" y="${y + 5}" font-family="Arial, Helvetica, sans-serif" 
            font-size="26" font-weight="bold" fill="white" 
            text-anchor="middle" letter-spacing="1">${escapeXml(text)}</text>
    </svg>
  `;
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += ' ' + word;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  return lines.slice(0, 4); // Max 4 lines
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { generatePinImage };
