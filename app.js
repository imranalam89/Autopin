// ========================
// State
// ========================
let selectedProduct = null;
let generatedImage = null;
let currentSettings = null;
let imageMode = 'classic'; // 'classic' or 'ai'
let autoPipelineRunning = false;
let autoEventSource = null;

// ========================
// Backend URL Management
// The backend (Node.js/Express) can be running locally OR on Render.com.
// The user sets the URL once in Settings and it's saved to localStorage.
// ========================
function getBackendUrl() {
  const stored = localStorage.getItem('backendUrl');
  // If user has set a backend URL, use it; otherwise use relative (works locally)
  return stored ? stored.replace(/\/$/, '') : '';
}

function apiUrl(path) {
  return getBackendUrl() + path;
}

// ========================
// DOM Ready
// ========================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSearch();
  initGenerate();
  initPost();
  initAutoMode();
  initSettings();
  loadSettingsFromServer();
  checkBackendConnection();
});

async function checkBackendConnection() {
  const backendUrl = getBackendUrl();
  // If no backend URL set, show a first-run banner
  if (!backendUrl) {
    showBackendBanner('not-configured');
    return;
  }
  try {
    const res = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      hideBackendBanner();
    } else {
      showBackendBanner('error');
    }
  } catch {
    showBackendBanner('error');
  }
}

function showBackendBanner(state) {
  let banner = document.getElementById('backend-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'backend-banner';
    document.body.insertBefore(banner, document.body.firstChild);
  }
  if (state === 'not-configured') {
    banner.className = 'backend-banner warning';
    banner.innerHTML = `
      ⚠️ <strong>Backend not configured.</strong> Go to <strong>Settings → Backend URL</strong> and enter your Render.com backend URL to use all features.
      <button onclick="switchTab('settings');hideBackendBanner()" style="margin-left:12px;padding:4px 12px;border-radius:8px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-size:13px">Open Settings →</button>
    `;
  } else {
    banner.className = 'backend-banner error';
    banner.innerHTML = `
      ❌ <strong>Backend unreachable.</strong> Check your Backend URL in Settings, or make sure your Render.com service is running.
      <button onclick="switchTab('settings');hideBackendBanner()" style="margin-left:12px;padding:4px 12px;border-radius:8px;border:none;background:#ef4444;color:#fff;cursor:pointer;font-size:13px">Open Settings →</button>
    `;
  }
}

function hideBackendBanner() {
  const banner = document.getElementById('backend-banner');
  if (banner) banner.remove();
}


// ========================
// Navigation
// ========================
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // Hide step indicator on auto & settings tabs
  const stepIndicator = document.getElementById('step-indicator');
  if (stepIndicator) {
    stepIndicator.style.display = (tabId === 'auto' || tabId === 'settings') ? 'none' : 'flex';
  }

  // Update step indicator
  const stepMap = { search: 1, generate: 2, post: 3, settings: 0, auto: 0 };
  updateSteps(stepMap[tabId] || 0);
}

function updateSteps(current) {
  document.querySelectorAll('.step').forEach(s => {
    const step = parseInt(s.dataset.step);
    s.classList.remove('active', 'completed');
    if (step === current) s.classList.add('active');
    else if (step < current) s.classList.add('completed');
  });
}

// ========================
// Search
// ========================
function initSearch() {
  const searchBtn = document.getElementById('search-btn');
  const searchInput = document.getElementById('search-input');

  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
}

async function performSearch() {
  const keywords = document.getElementById('search-input').value.trim();
  const category = document.getElementById('search-category').value;

  if (!keywords) {
    showToast('Please enter search keywords', 'error');
    return;
  }

  const btn = document.getElementById('search-btn');
  setButtonLoading(btn, true);

  try {
    const res = await fetch(apiUrl('/api/amazon/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, category })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error);
    if (!data.products.length) {
      showToast('No products found. Try different keywords.', 'info');
      return;
    }

    renderProducts(data.products);
    showToast(`Found ${data.products.length} products`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function renderProducts(products) {
  const grid = document.getElementById('search-results');
  const empty = document.getElementById('search-empty');
  if (empty) empty.remove();

  grid.innerHTML = products.map(p => `
    <div class="product-card" data-asin="${p.asin}">
      <div class="product-card-image">
        <img src="${p.imageUrl}" alt="${escapeHtml(p.title)}" loading="lazy">
      </div>
      <div class="product-card-body">
        <div class="product-card-title">${escapeHtml(p.title)}</div>
        ${p.brand ? `<div class="product-card-brand">by ${escapeHtml(p.brand)}</div>` : ''}
        <div>
          <span class="product-card-price">${escapeHtml(p.price)}</span>
          ${p.originalPrice ? `<span class="product-card-original-price">${escapeHtml(p.originalPrice)}</span>` : ''}
        </div>
        <button class="product-card-select">Select Product →</button>
      </div>
    </div>
  `).join('');

  // Add click handlers
  grid.querySelectorAll('.product-card').forEach((card, i) => {
    card.addEventListener('click', () => selectProduct(products[i], card));
  });
}

function selectProduct(product, cardEl) {
  selectedProduct = product;

  // Visual selection
  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  // Populate generate tab
  populatePreview(product);

  showToast('Product selected! Go to Generate tab.', 'success');

  // Auto-switch to generate tab after brief delay
  setTimeout(() => switchTab('generate'), 600);
}

// ========================
// Generate
// ========================
function initGenerate() {
  document.getElementById('generate-btn').addEventListener('click', generateImage);
  document.getElementById('regenerate-btn').addEventListener('click', generateImage);
  document.getElementById('proceed-to-post-btn').addEventListener('click', () => {
    if (generatedImage) {
      populatePostTab();
      switchTab('post');
    }
  });
  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const input = document.getElementById('preview-affiliate-link');
    navigator.clipboard.writeText(input.value).then(() => showToast('Link copied!', 'success'));
  });
}

function populatePreview(product) {
  document.getElementById('generate-empty').classList.add('hidden');
  document.getElementById('product-preview').classList.remove('hidden');

  document.getElementById('preview-product-image').src = product.imageUrl;
  document.getElementById('preview-title').textContent = product.title;
  document.getElementById('preview-brand').textContent = product.brand ? `by ${product.brand}` : '';
  document.getElementById('preview-price').textContent = product.price;
  document.getElementById('preview-original-price').textContent = product.originalPrice || '';
  document.getElementById('preview-affiliate-link').value = product.affiliateLink;

  const featuresEl = document.getElementById('preview-features');
  featuresEl.innerHTML = product.features.map(f =>
    `<div class="preview-feature">${escapeHtml(f.substring(0, 100))}</div>`
  ).join('');
}

async function generateImage() {
  if (!selectedProduct) {
    showToast('Select a product first', 'error');
    return;
  }

  const btn = document.getElementById('generate-btn');
  setButtonLoading(btn, true);

  const endpoint = imageMode === 'ai' ? '/api/image/generate-ai' : '/api/image/generate';

  try {
    const res = await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: selectedProduct })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    generatedImage = data;
    // Prefix image URL with backend URL so images hosted on Render.com load correctly
    const fullImageUrl = getBackendUrl() + data.imageUrl;
    generatedImage.fullImageUrl = fullImageUrl;

    // Show generated image
    document.getElementById('generated-preview').classList.remove('hidden');
    document.getElementById('generated-image').src = fullImageUrl + '?t=' + Date.now();

    const label = imageMode === 'ai' ? '✨ AI Pin image generated!' : '🖼️ Pin image generated!';
    showToast(label, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ========================
// Post
// ========================
function initPost() {
  document.getElementById('post-btn').addEventListener('click', postToPinterest);

  // Char counters
  document.getElementById('pin-title').addEventListener('input', (e) => {
    document.getElementById('title-count').textContent = e.target.value.length;
  });
  document.getElementById('pin-description').addEventListener('input', (e) => {
    document.getElementById('desc-count').textContent = e.target.value.length;
  });
}

function populatePostTab() {
  document.getElementById('post-empty').classList.add('hidden');
  document.getElementById('post-form-section').classList.remove('hidden');
  const imgSrc = (generatedImage.fullImageUrl || generatedImage.imageUrl) + '?t=' + Date.now();
  document.getElementById('post-preview-image').src = imgSrc;
  document.getElementById('pin-link').value = selectedProduct.affiliateLink;

  // Auto-generate title & description
  const title = selectedProduct.title.substring(0, 100);
  const desc = `${selectedProduct.title}\n\n${selectedProduct.price}\n\n${selectedProduct.features.join('\n')}\n\n🛒 Shop now on Amazon!`;

  document.getElementById('pin-title').value = title;
  document.getElementById('title-count').textContent = title.length;
  document.getElementById('pin-description').value = desc.substring(0, 500);
  document.getElementById('desc-count').textContent = Math.min(desc.length, 500);

  // Set default board from settings
  if (currentSettings && currentSettings.pinterest.defaultBoard) {
    document.getElementById('pin-board').value = currentSettings.pinterest.defaultBoard;
  }
}

async function postToPinterest() {
  const btn = document.getElementById('post-btn');
  setButtonLoading(btn, true);

  const statusFeed = document.getElementById('status-feed');
  const statusList = document.getElementById('status-list');
  statusFeed.classList.remove('hidden');
  statusList.innerHTML = '';

  // Start SSE for real-time status (must use full backend URL for Render.com)
  const eventSource = new EventSource(apiUrl('/api/pinterest/status'));
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    addStatusItem(data.message, data.type);
  };

  try {
    const res = await fetch(apiUrl('/api/pinterest/post'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagePath: generatedImage.outputPath || generatedImage.imageUrl,
        title: document.getElementById('pin-title').value,
        description: document.getElementById('pin-description').value,
        link: document.getElementById('pin-link').value,
        board: document.getElementById('pin-board').value
      })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error);
    showToast('Pin posted successfully! 🎉', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    addStatusItem('Error: ' + err.message, 'error');
  } finally {
    eventSource.close();
    setButtonLoading(btn, false);
  }
}

function addStatusItem(message, type) {
  const list = document.getElementById('status-list');
  const item = document.createElement('div');
  item.className = `status-item ${type}`;
  item.innerHTML = `<div class="status-dot"></div><span>${escapeHtml(message)}</span>`;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

// ========================
// Settings
// ========================
function initSettings() {
  document.getElementById('save-settings-btn').addEventListener('click', saveSettingsToServer);

  // Test backend connection button
  const testBtn = document.getElementById('test-backend-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const urlInput = document.getElementById('backend-url');
      const url = (urlInput?.value || '').trim().replace(/\/$/, '');
      const badge = document.getElementById('backend-status-badge');
      setButtonLoading(testBtn, true);
      try {
        const res = await fetch((url || '') + '/api/health', { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        if (data.status === 'ok') {
          showToast('✅ Backend connected successfully!', 'success');
          if (badge) { badge.textContent = '✅ Connected'; badge.style.color = '#10b981'; badge.style.borderColor = 'rgba(16,185,129,0.5)'; }
          hideBackendBanner();
        } else {
          showToast('Backend responded but with unexpected data', 'warning');
        }
      } catch (err) {
        showToast('❌ Cannot reach backend: ' + err.message, 'error');
        if (badge) { badge.textContent = '❌ Unreachable'; badge.style.color = '#ef4444'; badge.style.borderColor = 'rgba(239,68,68,0.5)'; }
      } finally {
        setButtonLoading(testBtn, false);
      }
    });
  }

  // Toggle password visibility
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.type = target.type === 'password' ? 'text' : 'password';
      btn.textContent = target.type === 'password' ? '👁️' : '🙈';
    });
  });

  // Color input sync
  document.getElementById('image-gradient-start').addEventListener('input', (e) => {
    document.getElementById('gradient-start-value').textContent = e.target.value;
  });
  document.getElementById('image-gradient-end').addEventListener('input', (e) => {
    document.getElementById('gradient-end-value').textContent = e.target.value;
  });

  // Image mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      imageMode = btn.dataset.mode;
      // Update description visibility
      document.querySelectorAll('.mode-desc').forEach(d => d.classList.add('hidden'));
      const desc = document.getElementById(`desc-${imageMode}`);
      if (desc) desc.classList.remove('hidden');
    });
  });
}


async function loadSettingsFromServer() {
  try {
    const res = await fetch(apiUrl('/api/settings'));
    const data = await res.json();
    if (data.success) {
      currentSettings = data.raw;
      populateSettingsForm(data.raw);
      updateAutoModeIndicator(data.raw);
    }
  } catch (err) {
    console.log('Settings not loaded yet — first run or backend not connected');
  }
}

function updateAutoModeIndicator(settings) {
  const hasGemini = !!(settings?.gemini?.apiKey);
  const hasKieAi = !!(settings?.kieAi?.apiKey);
  const mode = settings?.image?.mode || 'classic';
  const badge = document.getElementById('auto-mode-badge');
  const infoRow = document.getElementById('auto-mode-info');

  if (badge) {
    if (mode === 'kie-ai' && hasKieAi) {
      badge.textContent = '🤖 Kie.ai Mode';
      badge.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(239,68,68,0.25))';
      badge.style.borderColor = 'rgba(245,158,11,0.5)';
      badge.style.color = '#fbbf24';
    } else if (mode === 'gemini-web') {
      badge.textContent = '🌐 Gemini Web Mode';
      badge.style.background = 'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(37,99,235,0.25))';
      badge.style.borderColor = 'rgba(6,182,212,0.5)';
      badge.style.color = '#67e8f9';
    } else if (hasGemini && mode === 'ai') {
      badge.textContent = '✨ Gemini AI Mode';
      badge.style.background = 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.3))';
      badge.style.borderColor = 'rgba(124,58,237,0.5)';
      badge.style.color = 'var(--accent3)';
    } else {
      badge.textContent = '🔧 No API Required';
      badge.style.background = 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.25))';
      badge.style.borderColor = 'rgba(16,185,129,0.4)';
      badge.style.color = 'var(--success)';
    }
  }

  if (infoRow) {
    const icon = infoRow.querySelector('.mode-info-icon');
    const text = infoRow.querySelector('.mode-info-text');
    if (mode === 'kie-ai' && hasKieAi) {
      icon.textContent = '🤖';
      text.innerHTML = 'Running in <strong>Kie.ai Mode</strong> — Seedream AI generates Pinterest images';
    } else if (mode === 'gemini-web') {
      icon.textContent = '🌐';
      text.innerHTML = 'Running in <strong>Gemini Web Mode</strong> — opens gemini.google.com, downloads image';
    } else if (hasGemini && mode === 'ai') {
      icon.textContent = '✨';
      text.innerHTML = 'Running in <strong>Gemini AI Mode</strong> — AI product discovery + AI images';
    } else {
      icon.textContent = '🔧';
      text.innerHTML = 'Running in <strong>No-API Mode</strong> — Best Sellers scraping + Classic images';
    }
  }
}

function populateSettingsForm(s) {
  document.getElementById('amazon-partner-tag').value = s.amazon.partnerTag || '';
  document.getElementById('amazon-marketplace').value = s.amazon.marketplace || 'www.amazon.com';
  document.getElementById('pinterest-email').value = s.pinterest.email || '';
  document.getElementById('pinterest-password').value = s.pinterest.password || '';
  document.getElementById('pinterest-session-cookie').value = s.pinterest.sessionCookie || '';
  document.getElementById('pinterest-board').value = s.pinterest.defaultBoard || '';
  document.getElementById('image-gradient-start').value = s.image?.gradientStart || '#7c3aed';
  document.getElementById('image-gradient-end').value = s.image?.gradientEnd || '#06b6d4';
  document.getElementById('gradient-start-value').textContent = s.image?.gradientStart || '#7c3aed';
  document.getElementById('gradient-end-value').textContent = s.image?.gradientEnd || '#06b6d4';
  document.getElementById('image-cta-text').value = s.image?.ctaText || 'Shop Now on Amazon';
  document.getElementById('image-show-price').checked = s.image?.showPrice !== false;
  document.getElementById('image-show-rating').checked = s.image?.showRating !== false;

  // Gemini settings
  if (s.gemini?.apiKey) {
    document.getElementById('gemini-api-key').value = s.gemini.apiKey;
  }

  // Kie.ai settings
  if (s.kieAi?.apiKey) {
    document.getElementById('kie-ai-api-key').value = s.kieAi.apiKey;
  }

  // Image mode toggle
  const mode = s.image?.mode || 'classic';
  imageMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-desc').forEach(d => d.classList.add('hidden'));
  const desc = document.getElementById(`desc-${mode}`);
  if (desc) desc.classList.remove('hidden');

  // Populate Backend URL from localStorage
  const backendUrlInput = document.getElementById('backend-url');
  if (backendUrlInput) {
    backendUrlInput.value = localStorage.getItem('backendUrl') || '';
  }
}

async function saveSettingsToServer() {
  const btn = document.getElementById('save-settings-btn');
  setButtonLoading(btn, true);

  // Save backend URL to localStorage (client-side only)
  const backendUrlInput = document.getElementById('backend-url');
  if (backendUrlInput) {
    const newUrl = backendUrlInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('backendUrl', newUrl);
    // Re-check connection with new URL
    setTimeout(() => checkBackendConnection(), 500);
  }

  const settings = {
    amazon: {
      partnerTag: document.getElementById('amazon-partner-tag').value.trim(),
      marketplace: document.getElementById('amazon-marketplace').value
    },
    pinterest: {
      email: document.getElementById('pinterest-email').value.trim(),
      password: document.getElementById('pinterest-password').value.trim(),
      sessionCookie: document.getElementById('pinterest-session-cookie').value.trim(),
      defaultBoard: document.getElementById('pinterest-board').value.trim()
    },
    image: {
      gradientStart: document.getElementById('image-gradient-start').value,
      gradientEnd: document.getElementById('image-gradient-end').value,
      ctaText: document.getElementById('image-cta-text').value.trim(),
      showPrice: document.getElementById('image-show-price').checked,
      showRating: document.getElementById('image-show-rating').checked,
      mode: imageMode
    },
    gemini: {
      apiKey: document.getElementById('gemini-api-key').value.trim(),
      model: 'gemini-2.0-flash'
    },
    kieAi: {
      apiKey: document.getElementById('kie-ai-api-key').value.trim(),
      model: 'seedream/text-to-image'
    },
    autoMode: {
      niche: document.getElementById('auto-niche')?.value.trim() || 'tech gadgets',
      postsPerRun: parseInt(document.getElementById('auto-posts-count')?.value) || 3,
      delayBetweenPosts: 30
    }
  };

  try {
    const res = await fetch(apiUrl('/api/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentSettings = settings;
    updateAutoModeIndicator(settings);
    showToast('Settings saved successfully!', 'success');
  } catch (err) {
    showToast('Backend settings: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}



// ========================
// Auto Mode
// ========================
function initAutoMode() {
  // Niche chips
  document.querySelectorAll('.niche-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.niche-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      document.getElementById('auto-niche').value = chip.dataset.niche;
    });
  });

  // Slider
  const slider = document.getElementById('auto-posts-count');
  slider.addEventListener('input', () => {
    document.getElementById('auto-posts-value').textContent = slider.value;
  });

  // Run button
  document.getElementById('auto-run-btn').addEventListener('click', runAutoPipeline);

  // Stop button
  document.getElementById('auto-stop-btn').addEventListener('click', stopAutoPipeline);
}

async function runAutoPipeline() {
  if (autoPipelineRunning) return;

  const niche = document.getElementById('auto-niche').value.trim();
  const postsPerRun = parseInt(document.getElementById('auto-posts-count').value) || 3;

  if (!niche) {
    showToast('Please enter a product niche', 'error');
    return;
  }

  // Clear status
  const statusList = document.getElementById('auto-status-list');
  const emptyState = document.getElementById('auto-status-empty');
  statusList.innerHTML = '';
  emptyState.style.display = 'none';

  // Update UI state
  autoPipelineRunning = true;
  const runBtn = document.getElementById('auto-run-btn');
  const stopBtn = document.getElementById('auto-stop-btn');
  setButtonLoading(runBtn, true);
  stopBtn.style.display = 'block';

  // Set status indicator
  const dot = document.getElementById('auto-status-dot');
  dot.className = 'status-indicator active';

  // Start SSE stream for live updates (must use full backend URL for Render.com)
  if (autoEventSource) autoEventSource.close();
  autoEventSource = new EventSource(apiUrl('/api/pinterest/status'));
  autoEventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    addAutoStatus(data.message, data.type);
  };

  try {
    const res = await fetch(apiUrl('/api/auto/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, postsPerRun, imageMode })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    addAutoStatus('🚀 Pipeline started! Follow the live status below...', 'success');
    showToast('Auto pipeline started!', 'success');

    // Wait for pipeline to complete (monitor via SSE)
    // Pipeline will finish when success/error message comes through
    await waitForPipelineComplete();
  } catch (err) {
    showToast(err.message, 'error');
    addAutoStatus('✗ Failed to start: ' + err.message, 'error');
    dot.className = 'status-indicator error';
  } finally {
    autoPipelineRunning = false;
    setButtonLoading(runBtn, false);
    stopBtn.style.display = 'none';
    if (autoEventSource) { autoEventSource.close(); autoEventSource = null; }
    if (dot.classList.contains('active')) dot.className = 'status-indicator';
  }
}

function waitForPipelineComplete() {
  return new Promise((resolve) => {
    // Resolve after 10 minutes max, or when pipeline complete message arrives
    const timeout = setTimeout(resolve, 10 * 60 * 1000);
    const originalOnMessage = autoEventSource?.onmessage;
    if (autoEventSource) {
      autoEventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        addAutoStatus(data.message, data.type);
        if (data.message && (data.message.includes('complete!') || data.message.includes('Error'))) {
          clearTimeout(timeout);
          setTimeout(resolve, 2000);
        }
      };
    } else {
      resolve();
    }
  });
}

function stopAutoPipeline() {
  autoPipelineRunning = false;
  if (autoEventSource) { autoEventSource.close(); autoEventSource = null; }
  addAutoStatus('⏹ Pipeline stopped by user.', 'warning');
  document.getElementById('auto-status-dot').className = 'status-indicator';
  document.getElementById('auto-stop-btn').style.display = 'none';
  const runBtn = document.getElementById('auto-run-btn');
  setButtonLoading(runBtn, false);
  showToast('Pipeline stopped', 'info');
}

function addAutoStatus(message, type = 'info') {
  const list = document.getElementById('auto-status-list');
  const item = document.createElement('div');
  item.className = `status-item ${type || 'info'}`;
  item.innerHTML = `<div class="status-dot"></div><span>${escapeHtml(String(message))}</span>`;
  list.appendChild(item);
  // Auto scroll to bottom
  const feed = document.getElementById('auto-status-feed');
  feed.scrollTop = feed.scrollHeight;
}

// ========================
// Utilities
// ========================
function setButtonLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  if (loading) {
    text.classList.add('hidden');
    loader.classList.remove('hidden');
    btn.disabled = true;
  } else {
    text.classList.remove('hidden');
    loader.classList.add('hidden');
    btn.disabled = false;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fadeOut');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
