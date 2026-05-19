/**
 * Kie.ai Image Generation Service
 * Uses the Market API (Seedream 3.0 - Text to Image)
 * Docs: https://docs.kie.ai/market/seedream/seedream
 *
 * Flow:
 * 1. POST to /api/v1/market  → returns { data: { taskId } }
 * 2. Poll GET /api/v1/jobs/recordInfo?taskId=... until state === 'success'
 * 3. Parse resultJson.resultUrls[0] and download the image
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.kie.ai';
const GENERATE_PATH = '/api/v1/market';
const STATUS_PATH = '/api/v1/jobs/recordInfo';

const GENERATED_DIR = path.join(__dirname, '..', 'generated');

// Ensure output directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * Build a vivid, Pinterest-optimized prompt from a product object.
 */
function buildImagePrompt(product) {
  const title = product.title || 'Amazing Amazon Product';
  const price = product.price ? ` Priced at ${product.price}.` : '';
  const brand = product.brand ? ` by ${product.brand}.` : '';

  return (
    `Create a stunning, Pinterest-style product promotion image for: "${title}".` +
    brand +
    price +
    ` The image should be vibrant, eye-catching, with a clean white or gradient background.` +
    ` Show the product clearly, with bold typography saying "Shop on Amazon" at the bottom.` +
    ` Vertical 2:3 aspect ratio. Professional photography style. High quality marketing image.`
  );
}

/**
 * Submit an image generation task to Kie.ai.
 * @param {string} apiKey  - Kie.ai Bearer token
 * @param {string} prompt  - Text prompt for the image
 * @returns {Promise<string>} taskId
 */
async function submitTask(apiKey, prompt) {
  const payload = {
    model: 'seedream/text-to-image', // Seedream 3.0
    callBackUrl: '',                  // No callback – we will poll
    input: {
      prompt,
      aspect_ratio: '2:3',           // Pinterest-friendly portrait
      image_count: 1
    }
  };

  const response = await axios.post(`${BASE_URL}${GENERATE_PATH}`, payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  const data = response.data;

  // Check for API-level success
  if (!data || !data.data || !data.data.taskId) {
    throw new Error(`Kie.ai task submission failed: ${JSON.stringify(data)}`);
  }

  return data.data.taskId;
}

/**
 * Poll the task status endpoint until the task succeeds or fails.
 * @param {string} apiKey
 * @param {string} taskId
 * @param {number} maxWaitMs   - Max total wait in milliseconds (default 3 min)
 * @param {number} intervalMs  - Polling interval (default 5 sec)
 * @returns {Promise<string>} URL of the generated image
 */
async function pollTaskResult(apiKey, taskId, maxWaitMs = 180000, intervalMs = 5000) {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const response = await axios.get(`${BASE_URL}${STATUS_PATH}`, {
      params: { taskId },
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 15000
    });

    const taskData = response.data && response.data.data;
    if (!taskData) {
      throw new Error('Kie.ai: Unexpected poll response format');
    }

    const state = taskData.state;
    console.log(`[Kie.ai] Task ${taskId} state: ${state} (progress: ${taskData.progress ?? '?'}%)`);

    if (state === 'success') {
      // resultJson is a JSON string
      let resultUrls;
      try {
        const parsed = JSON.parse(taskData.resultJson);
        resultUrls = parsed.resultUrls;
      } catch (e) {
        throw new Error('Kie.ai: Could not parse resultJson: ' + taskData.resultJson);
      }

      if (!resultUrls || resultUrls.length === 0) {
        throw new Error('Kie.ai: No result URLs in response');
      }

      return resultUrls[0];
    }

    if (state === 'failed' || state === 'error') {
      throw new Error(`Kie.ai task failed: ${taskData.failMsg || state}`);
    }

    // States like 'pending', 'running', 'processing' → keep polling
  }

  throw new Error(`Kie.ai: Task ${taskId} timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Download the image from a URL and save it to the generated directory.
 * @param {string} imageUrl
 * @returns {Promise<{filename: string, outputPath: string}>}
 */
async function downloadImage(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 60000
  });

  const filename = `kie-${Date.now()}.jpg`;
  const outputPath = path.join(GENERATED_DIR, filename);

  fs.writeFileSync(outputPath, Buffer.from(response.data));
  return { filename, outputPath };
}

/**
 * Main export: generate a Pinterest-optimized image using Kie.ai.
 * @param {object} product  - { title, price, brand, ... }
 * @param {object} settings - Full app settings object (needs settings.kieAi.apiKey)
 * @returns {Promise<{filename: string, outputPath: string}>}
 */
async function generateImageWithKieAi(product, settings) {
  const apiKey = settings && settings.kieAi && settings.kieAi.apiKey;
  if (!apiKey) {
    throw new Error('Kie.ai API key is not configured. Please add it in Settings.');
  }

  const prompt = buildImagePrompt(product);
  console.log('[Kie.ai] Submitting task with prompt:', prompt.substring(0, 100) + '...');

  const taskId = await submitTask(apiKey, prompt);
  console.log('[Kie.ai] Task submitted. ID:', taskId);

  const imageUrl = await pollTaskResult(apiKey, taskId);
  console.log('[Kie.ai] Image ready at:', imageUrl);

  const result = await downloadImage(imageUrl);
  console.log('[Kie.ai] Image saved to:', result.outputPath);

  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { generateImageWithKieAi };
