const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');

const DEFAULT_SETTINGS = {
  amazon: {
    partnerTag: '',
    marketplace: 'www.amazon.com'
  },
  pinterest: {
    email: '',
    password: '',
    defaultBoard: ''
  },
  image: {
    gradientStart: '#7c3aed',
    gradientEnd: '#06b6d4',
    ctaText: 'Shop Now on Amazon',
    showPrice: true,
    showRating: true,
    mode: 'classic' // 'classic' | 'ai' | 'gemini-web' | 'kie-ai'
  },
  gemini: {
    apiKey: '',
    model: 'gemini-2.0-flash'
  },
  kieAi: {
    apiKey: '',
    model: 'seedream/text-to-image'
  },
  autoMode: {
    niche: 'tech gadgets',
    postsPerRun: 3,
    delayBetweenPosts: 30
  }
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      // Deep merge with defaults so new fields are always present
      return deepMerge(DEFAULT_SETTINGS, saved);
    }
  } catch (err) {
    console.error('Error loading settings:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Error saving settings:', err.message);
    return { success: false, error: err.message };
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { loadSettings, saveSettings, DEFAULT_SETTINGS };
