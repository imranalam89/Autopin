const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

puppeteer.use(StealthPlugin());

const GENERATED_DIR = path.join(__dirname, '..', 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// Find the Chrome user data directory (so we stay logged in to Google)
function getChromeUserDataDir() {
  const username = os.userInfo().username;
  const candidates = [
    `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome\\User Data`,
    `C:\\Users\\${username}\\AppData\\Local\\Google\\Chrome Beta\\User Data`,
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// Find Chrome executable
function getChromeExePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `C:\\Users\\${os.userInfo().username}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const exe of candidates) {
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

let statusCallback = null;
function setStatusCallback(cb) { statusCallback = cb; }
function sendStatus(message, type = 'info') {
  console.log(`[GeminiWeb] ${message}`);
  if (statusCallback) statusCallback({ message, type, timestamp: Date.now() });
}

/**
 * Open Gemini web app, send a prompt, wait for image, download and save it.
 * Uses the user's existing Chrome profile so they stay logged in to Google.
 */
async function generateImageViaGeminiWeb(prompt, options = {}) {
  const userDataDir = getChromeUserDataDir();
  const chromeExe = getChromeExePath();

  sendStatus('🌐 Launching Chrome with your Google account...', 'info');

  const launchOptions = {
    headless: process.env.NODE_ENV === 'production' ? true : false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
      '--profile-directory=Default', // Use default Chrome profile
      '--disable-gpu',
      '--disable-dev-shm-usage'
    ],
  };

  // Use existing Chrome profile if found (keeps Google login)
  if (userDataDir) {
    launchOptions.userDataDir = userDataDir;
    sendStatus(`✓ Using Chrome profile: ${userDataDir.split('\\').slice(-3).join('\\')}`, 'success');
  } else {
    sendStatus('⚠ Chrome profile not found — you may need to log in to Google manually', 'warning');
  }

  // Use system Chrome if found
  if (chromeExe) {
    launchOptions.executablePath = chromeExe;
    sendStatus(`✓ Using Chrome: ${chromeExe}`, 'info');
  }

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Navigate to Gemini
    sendStatus('🔗 Opening Gemini...', 'info');
    await page.goto('https://gemini.google.com/app', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(3000);

    // Check if we're on the login page
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      sendStatus('⚠ Not logged in to Google. Please log in manually in the browser window, then the process will continue...', 'warning');
      // Wait up to 2 minutes for user to log in
      await page.waitForNavigation({ timeout: 120000, waitUntil: 'networkidle2' }).catch(() => {});
      await delay(3000);
    }

    sendStatus('✓ Gemini is open! Typing the prompt...', 'success');

    // Find the text input area
    const inputSelectors = [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      'textarea[placeholder]',
      'p[data-placeholder]',
    ];

    let inputEl = null;
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
        inputEl = await page.$(sel);
        if (inputEl) {
          sendStatus(`✓ Found input field`, 'info');
          break;
        }
      } catch {}
    }

    if (!inputEl) {
      throw new Error('Could not find Gemini input box. Please make sure you are logged in to Gemini.');
    }

    // Click and type the prompt
    await inputEl.click();
    await delay(500);
    await page.keyboard.type(prompt, { delay: 30 });
    await delay(800);

    // Press Enter to submit
    await page.keyboard.press('Enter');
    sendStatus('📤 Prompt submitted! Waiting for image generation...', 'info');

    // Wait for image to appear in the response
    // Gemini shows images in .response-container or similar
    const imageSelectors = [
      'div[data-response-index] img[src*="generativelanguage"]',
      'message-content img:not([src*="icon"]):not([src*="avatar"]):not([src*="profile"])',
      'model-response img[src*="blob"]',
      'model-response img[src*="http"]',
      '.response-content img',
      'div[class*="response"] img[width]',
      'chat-message img[src]',
    ];

    sendStatus('⏳ Waiting up to 60 seconds for image...', 'info');
    let imgSrc = null;
    const startTime = Date.now();
    const maxWait = 90000; // 90 seconds

    while (!imgSrc && Date.now() - startTime < maxWait) {
      await delay(2000);

      // Try each selector
      for (const sel of imageSelectors) {
        try {
          const imgs = await page.$$(sel);
          for (const img of imgs) {
            const src = await page.evaluate(el => el.src || el.getAttribute('src'), img);
            const width = await page.evaluate(el => el.naturalWidth || el.width, img);
            if (src && width > 100 && !src.includes('avatar') && !src.includes('icon') && !src.includes('profile') && !src.includes('logo')) {
              imgSrc = src;
              sendStatus(`✓ Found generated image!`, 'success');
              break;
            }
          }
          if (imgSrc) break;
        } catch {}
      }

      // Also try finding any large image that appeared after our prompt
      if (!imgSrc) {
        try {
          imgSrc = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const big = imgs.find(img => {
              const src = img.src || '';
              const w = img.naturalWidth || img.width || 0;
              return w > 200 && src && !src.includes('icon') && !src.includes('avatar')
                && !src.includes('profile') && !src.includes('google.com/images')
                && !src.includes('gstatic') && !src.includes('logo');
            });
            return big ? big.src : null;
          });
          if (imgSrc) sendStatus('✓ Found image via fallback detection!', 'success');
        } catch {}
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (!imgSrc && elapsed % 10 === 0) {
        sendStatus(`⏳ Still waiting for image... (${elapsed}s)`, 'info');
      }
    }

    if (!imgSrc) {
      throw new Error('Gemini did not generate an image within 90 seconds. The prompt may not have triggered image generation, or Gemini may not support image generation in your region/account.');
    }

    // Download the image
    sendStatus('💾 Downloading generated image...', 'info');
    const filename = `pin-gemini-web-${Date.now()}.png`;
    const outputPath = path.join(GENERATED_DIR, filename);

    if (imgSrc.startsWith('blob:')) {
      // Download blob URL via page.evaluate
      const base64Data = await page.evaluate(async (blobUrl) => {
        const resp = await fetch(blobUrl);
        const blob = await resp.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }, imgSrc);
      fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
    } else {
      // Download regular URL
      const cookies = await page.cookies('https://gemini.google.com');
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const response = await axios.get(imgSrc, {
        responseType: 'arraybuffer',
        headers: { Cookie: cookieStr, Referer: 'https://gemini.google.com/' }
      });
      fs.writeFileSync(outputPath, Buffer.from(response.data));
    }

    sendStatus(`✓ Image saved: ${filename}`, 'success');

    // Close browser
    await delay(2000);
    await browser.close();

    return { filename, outputPath, imageUrl: `/generated/${filename}` };
  } catch (err) {
    sendStatus(`✗ Error: ${err.message}`, 'error');
    if (browser) { try { await browser.close(); } catch {} }
    throw err;
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generateImageViaGeminiWeb, setStatusCallback };
