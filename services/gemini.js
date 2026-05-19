const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const GENERATED_DIR = path.join(__dirname, '..', 'generated');

// Ensure output directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * Discover trending product ideas using Gemini AI
 * Returns structured suggestions with keywords, reasoning, and pin hooks
 */
async function discoverProducts(niche, settings) {
  const apiKey = settings.gemini?.apiKey;
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Go to Settings to add it.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are an expert Amazon affiliate marketer and Pinterest strategist.

I need you to find **5 trending, high-converting product ideas** for the niche: "${niche}"

For each product, provide:
1. **keyword** — The exact Amazon search keyword (specific enough to find real products)
2. **category** — Best Amazon category (one of: All, Electronics, Books, Fashion, HomeAndKitchen, Beauty, Sports, Toys, Garden, HealthPersonalCare, Automotive, Software)
3. **whyTrending** — One sentence on why this is hot right now
4. **pinTitle** — A catchy Pinterest pin title (max 100 chars)
5. **pinDescription** — An engaging Pinterest description with relevant hashtags (max 300 chars)
6. **imagePrompt** — A detailed prompt to generate a beautiful Pinterest product promotion image for this type of product

Return ONLY valid JSON array, no markdown, no code fences. Example format:
[{"keyword":"wireless earbuds 2025","category":"Electronics","whyTrending":"Remote work driving demand","pinTitle":"Best Wireless Earbuds Under $50","pinDescription":"Crystal clear sound meets all-day comfort. #TechDeals #WirelessEarbuds #AmazonFinds","imagePrompt":"A sleek modern product photography of premium wireless earbuds on a gradient purple background"}]`;

  const response = await ai.models.generateContent({
    model: settings.gemini?.model || 'gemini-2.0-flash',
    contents: prompt,
  });

  const text = response.text.trim();

  // Parse the JSON response — handle potential markdown wrapping
  let cleaned = text;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const suggestions = JSON.parse(cleaned);
    if (!Array.isArray(suggestions)) {
      throw new Error('Expected array from Gemini');
    }
    return suggestions;
  } catch (parseErr) {
    console.error('Gemini response parse error:', parseErr.message);
    console.error('Raw response:', text);
    throw new Error('Failed to parse Gemini product suggestions. Please try again.');
  }
}

/**
 * Generate a Pinterest-optimized product image using Gemini AI
 * Uses Gemini Flash with inline image generation (free tier)
 */
async function generatePinImageWithGemini(product, settings) {
  const apiKey = settings.gemini?.apiKey;
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Go to Settings to add it.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const productName = product.title || 'Product';
  const price = product.price || '';
  const brand = product.brand || '';

  // Build a detailed prompt for Pinterest-optimized image
  const customPrompt = product.imagePrompt || '';

  const prompt = `Generate a stunning Pinterest product promotion image with these requirements:

PRODUCT: ${productName}
${brand ? `BRAND: ${brand}` : ''}
${price ? `PRICE: ${price}` : ''}

DESIGN REQUIREMENTS:
- Pinterest optimal 2:3 aspect ratio (portrait orientation, 1000x1500 pixels)
- Modern, clean, premium product showcase layout
- Eye-catching vibrant gradient background (purple to cyan tones)
- Large, bold product title text at the top
- Professional product photography style composition
- A bold call-to-action button that says "Shop Now on Amazon" at the bottom
- Price badge displayed prominently if price is available
- The text "★ TRENDING ON AMAZON ★" as a banner at the very top
- Modern typography, clean white text on colored backgrounds
- Make it look like a premium Pinterest pin that would get high engagement and clicks
${customPrompt ? `\nADDITIONAL STYLE: ${customPrompt}` : ''}

Create a visually stunning, scroll-stopping promotional image that will drive clicks on Pinterest.`;

  const response = await ai.models.generateContent({
    model: settings.gemini?.model || 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  // Extract the image from the response
  if (!response.candidates || !response.candidates[0]) {
    throw new Error('No response from Gemini image generation');
  }

  const parts = response.candidates[0].content.parts;
  const imagePart = parts.find(part => part.inlineData);

  if (!imagePart) {
    throw new Error('Gemini did not return an image. The model may not support image generation on this API key tier. Try again or switch to Classic mode.');
  }

  // Save the image
  const filename = `pin-ai-${Date.now()}.png`;
  const outputPath = path.join(GENERATED_DIR, filename);
  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.writeFileSync(outputPath, buffer);

  console.log(`[Gemini] AI image saved: ${outputPath}`);

  return { filename, outputPath };
}

module.exports = { discoverProducts, generatePinImageWithGemini };
