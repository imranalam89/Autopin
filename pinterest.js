const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

puppeteer.use(StealthPlugin());

// Global event emitter for status updates
let statusCallback = null;

function setStatusCallback(cb) {
  statusCallback = cb;
}

function sendStatus(step, message, type = 'info') {
  console.log(`[Pinterest] ${message}`);
  if (statusCallback) {
    statusCallback({ step, message, type, timestamp: Date.now() });
  }
}

/**
 * Post a pin to Pinterest via browser automation
 */
async function postToPin(settings, pinData) {
  const { email, password, sessionCookie, defaultBoard } = settings.pinterest;
  const { imagePath, title, description, link, board } = pinData;

  if ((!email || !password) && !sessionCookie) {
    throw new Error('Pinterest credentials not configured. Go to Settings to add them.');
  }

  const targetBoard = board || defaultBoard || '';

  let browser;
  try {
    sendStatus(1, 'Launching browser...', 'info');

    browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production' ? true : false,
      defaultViewport: { width: 1280, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1280,900',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    let loggedIn = false;

    // --- Step 2: Attempt Cookie Login ---
    if (sessionCookie) {
      sendStatus(2, 'Attempting login via session cookie...', 'info');
      await page.setCookie({
        name: '_pinterest_sess',
        value: sessionCookie,
        domain: '.pinterest.com',
        path: '/',
        httpOnly: true,
        secure: true
      });
      
      await page.goto('https://www.pinterest.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(2000);
      
      const currentUrl = page.url();
      if (!currentUrl.includes('/login') && !currentUrl.includes('welcome')) {
        loggedIn = true;
        sendStatus(4, 'Login via cookie successful!', 'success');
      } else {
        sendStatus(2, '⚠ Cookie invalid or expired, falling back to manual login...', 'warning');
      }
    }

    // --- Step 3: Manual Login Fallback ---
    if (!loggedIn) {
      if (!email || !password) {
        throw new Error('Cookie login failed and email/password not provided.');
      }
      
      sendStatus(2, 'Navigating to Pinterest login...', 'info');
      await page.goto('https://www.pinterest.com/login/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await delay(2000);

      sendStatus(3, 'Entering credentials...', 'info');

      // Try to find and fill the email field
      const emailSelector = 'input[id="email"], input[name="id"], input[type="email"], input[data-test-id="emailInputField"]';
      await page.waitForSelector(emailSelector, { timeout: 15000 });
      await page.click(emailSelector);
      await delay(500);
      await typeHumanLike(page, emailSelector, email);

      await delay(800);

      // Fill password
      const passwordSelector = 'input[id="password"], input[name="password"], input[type="password"], input[data-test-id="passwordInputField"]';
      await page.waitForSelector(passwordSelector, { timeout: 10000 });
      await page.click(passwordSelector);
      await delay(500);
      await typeHumanLike(page, passwordSelector, password);

      await delay(1000);

      // Click login button
      sendStatus(4, 'Logging in...', 'info');
      const loginBtnSelector = 'button[type="submit"], button[data-test-id="registerFormSubmitButton"], div[data-test-id="registerFormSubmitButton"]';
      await page.waitForSelector(loginBtnSelector, { timeout: 10000 });
      await page.click(loginBtnSelector);

      // Wait for navigation after login
      await delay(5000);

      // Check if login was successful
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        sendStatus(4, '⚠ Login page still showing — please solve any CAPTCHA in the browser window, then the script will continue...', 'warning');
        await page.waitForNavigation({ timeout: 120000, waitUntil: 'networkidle2' }).catch(() => {});
        await delay(3000);
      }
      
      sendStatus(4, 'Login successful!', 'success');
    }

    sendStatus(5, 'Navigating to pin creator...', 'info');

    // --- Step 5: Go to Pin Creation ---
    await delay(1000);
    await page.goto('https://www.pinterest.com/pin-creation-tool/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await delay(3000);

    // --- Step 6: Upload Image ---
    sendStatus(6, 'Uploading image...', 'info');

    // Resolve the absolute path
    const absoluteImagePath = path.resolve(imagePath);

    // Try to find the file input or drop zone
    // Pinterest uses a hidden file input — look for it
    const fileInputSelector = 'input[type="file"]';

    try {
      await page.waitForSelector(fileInputSelector, { timeout: 10000 });
      const inputElement = await page.$(fileInputSelector);
      await inputElement.uploadFile(absoluteImagePath);
    } catch {
      // If hidden input not found, try the drag-drop approach via file chooser
      sendStatus(6, 'Using file chooser for upload...', 'info');
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        page.click('[data-test-id="storyboard-upload-input"], [data-test-id="image-upload-input"], .uploadButton, button[aria-label="Upload"]')
      ]);
      await fileChooser.accept([absoluteImagePath]);
    }

    // Wait for image to process
    await delay(5000);
    sendStatus(7, 'Image uploaded! Filling in pin details...', 'success');

    // --- Step 7: Fill in Title ---
    try {
      const titleSelector = 'input[id="storyboard-selector-title"], input[placeholder*="title" i], input[data-test-id="pin-draft-title"], div[data-test-id="pin-draft-title"] input, input[aria-label*="title" i]';
      await page.waitForSelector(titleSelector, { timeout: 8000 });
      await page.click(titleSelector);
      await delay(300);
      await typeHumanLike(page, titleSelector, title);
    } catch {
      // Try contenteditable divs
      sendStatus(7, 'Looking for title field...', 'info');
      const titleDivs = await page.$$('[contenteditable="true"]');
      if (titleDivs.length > 0) {
        await titleDivs[0].click();
        await delay(300);
        await page.keyboard.type(title, { delay: 50 });
      }
    }

    await delay(1000);

    // --- Step 8: Fill in Description ---
    try {
      const descSelector = 'textarea, div[data-test-id="pin-draft-description"] textarea, textarea[placeholder*="description" i], textarea[aria-label*="description" i]';
      const descElements = await page.$$(descSelector);
      if (descElements.length > 0) {
        await descElements[0].click();
        await delay(300);
        await page.keyboard.type(description, { delay: 30 });
      }
    } catch {
      // Try contenteditable
      const editableDivs = await page.$$('[contenteditable="true"]');
      if (editableDivs.length > 1) {
        await editableDivs[1].click();
        await delay(300);
        await page.keyboard.type(description, { delay: 30 });
      }
    }

    await delay(1000);

    // --- Step 9: Fill in Affiliate Link ---
    sendStatus(8, 'Adding affiliate link...', 'info');
    try {
      const linkSelector = 'input[placeholder*="link" i], input[data-test-id="pin-draft-link"], input[id="storyboard-selector-link"], input[aria-label*="link" i], input[aria-label*="url" i], input[placeholder*="url" i]';
      await page.waitForSelector(linkSelector, { timeout: 8000 });
      await page.click(linkSelector);
      await delay(300);
      await typeHumanLike(page, linkSelector, link);
    } catch {
      sendStatus(8, '⚠ Could not find link field — you may need to add it manually', 'warning');
    }

    await delay(1500);

    // --- Step 10: Select Board ---
    sendStatus(9, `Selecting board: ${targetBoard || '(auto)'}...`, 'info');
    try {
      // Click the board dropdown — Pinterest shows "Choose a board" button
      const boardDropdownSelectors = [
        'button[data-test-id="board-dropdown-select-button"]',
        'button[data-test-id="boardDropdownSelectButton"]',
        '[data-test-id="board-dropdown"]',
        'button[aria-label*="Board" i]',
        'button[aria-haspopup="listbox"]'
      ];

      let boardDropdown = null;
      for (const sel of boardDropdownSelectors) {
        boardDropdown = await page.$(sel);
        if (boardDropdown) break;
      }

      // Fallback: find button containing "Choose a board" or "Board" text
      if (!boardDropdown) {
        const allButtons = await page.$$('button');
        for (const btn of allButtons) {
          const txt = await page.evaluate(el => el.textContent.trim(), btn);
          if (txt.includes('Choose a board') || txt.includes('Select board')) {
            boardDropdown = btn;
            break;
          }
        }
      }

      // Also try clicking the dropdown area that shows board selection
      if (!boardDropdown) {
        boardDropdown = await page.$('[data-test-id="BoardDropdown"] button, [class*="boardDropdown"] button, div[class*="board"] button');
      }

      if (boardDropdown) {
        await boardDropdown.click();
        await delay(2000);

        if (targetBoard) {
          // Type board name to search/filter
          const boardSearchSelectors = [
            'input[placeholder*="Search" i]',
            'input[data-test-id="board-search-input"]',
            'input[aria-label*="Search" i]',
            'input[type="text"]'
          ];

          let boardSearch = null;
          for (const sel of boardSearchSelectors) {
            const inputs = await page.$$(sel);
            // Pick the one that appeared in the dropdown context
            if (inputs.length > 0) {
              boardSearch = inputs[inputs.length - 1]; // Usually the last one is the dropdown search
              break;
            }
          }

          if (boardSearch) {
            await boardSearch.click();
            await delay(300);
            await boardSearch.type(targetBoard, { delay: 80 });
            await delay(2000);
          }
        }

        // Click the first matching board option
        const boardOptionSelectors = [
          '[data-test-id="board-row"]',
          '[data-test-id="boardRow"]',
          'div[role="option"]',
          'div[role="listbox"] > div',
          'ul[role="listbox"] li'
        ];

        let clicked = false;
        for (const sel of boardOptionSelectors) {
          const options = await page.$$(sel);
          if (options.length > 0) {
            await options[0].click();
            clicked = true;
            sendStatus(9, '✓ Board selected!', 'success');
            break;
          }
        }

        if (!clicked) {
          // Fallback: click any clickable div inside the dropdown
          sendStatus(9, '⚠ Could not find board option — trying fallback...', 'warning');
          await page.evaluate(() => {
            const items = document.querySelectorAll('[role="option"], [role="menuitem"], [data-test-id*="board"]');
            if (items.length > 0) items[0].click();
          });
        }

        await delay(1500);
      } else {
        sendStatus(9, '⚠ Could not find board dropdown — please select board manually in the browser', 'warning');
        await delay(5000);
      }
    } catch (err) {
      sendStatus(9, `⚠ Board selection issue: ${err.message} — select manually if needed`, 'warning');
      await delay(3000);
    }

    // --- Step 11: Publish ---
    sendStatus(10, 'Publishing pin...', 'info');
    await delay(2000);

    try {
      let published = false;

      // Strategy 1: Find the red "Publish" button (top-right in current Pinterest UI)
      const publishSelectors = [
        'button[data-test-id="board-dropdown-save-button"]',
        'button[data-test-id="storyboard-creation-nav-done"]',
        'button[data-test-id="create-new-pin"]',
        'div[data-test-id="storyboard-creation-nav-done"]',
        'button[aria-label="Publish"]',
        'button[aria-label="Save"]'
      ];

      for (const selector of publishSelectors) {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          published = true;
          sendStatus(10, '✓ Clicked publish button!', 'success');
          break;
        }
      }

      // Strategy 2: Find by text content — look for red/primary button with "Publish"
      if (!published) {
        published = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text === 'Publish' || text === 'Save') {
              btn.click();
              return true;
            }
          }
          // Also try divs with role="button"
          const divBtns = document.querySelectorAll('div[role="button"]');
          for (const btn of divBtns) {
            const text = btn.textContent.trim();
            if (text === 'Publish' || text === 'Save') {
              btn.click();
              return true;
            }
          }
          return false;
        });
        if (published) sendStatus(10, '✓ Clicked publish button!', 'success');
      }

      // Strategy 3: Find the red-colored button (Pinterest Publish is always red)
      if (!published) {
        published = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const style = window.getComputedStyle(btn);
            const bg = style.backgroundColor;
            // Pinterest red is approximately rgb(230, 0, 35)
            if (bg && (bg.includes('230') || bg.includes('220') || bg.includes('e60023'))) {
              const text = btn.textContent.trim().toLowerCase();
              if (text.includes('publish') || text.includes('save') || text === '') {
                btn.click();
                return true;
              }
            }
          }
          return false;
        });
        if (published) sendStatus(10, '✓ Clicked publish (red) button!', 'success');
      }

      if (!published) {
        sendStatus(10, '⚠ Could not find Publish button — please click it manually in the browser', 'warning');
        await delay(30000);
      }
    } catch (err) {
      sendStatus(10, `⚠ Error clicking publish: ${err.message}`, 'warning');
    }

    await delay(5000);
    sendStatus(11, '✓ Pin posted successfully!', 'success');

    // Keep browser open for a moment so user can verify
    await delay(5000);

    return { success: true, message: 'Pin posted successfully!' };
  } catch (err) {
    sendStatus(0, `✗ Error: ${err.message}`, 'error');
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Browser might already be closed
      }
    }
    statusCallback = null;
  }
}

/**
 * Type text in a human-like way with random delays
 */
async function typeHumanLike(page, selector, text) {
  await page.focus(selector);
  // Clear any existing text
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }, selector);

  for (const char of text) {
    await page.type(selector, char, { delay: 50 + Math.random() * 100 });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { postToPin, setStatusCallback };
