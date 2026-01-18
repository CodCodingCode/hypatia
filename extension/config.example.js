// Configuration Template
// 1. Copy this file to config.js
// 2. Fill in your values
//
// IMPORTANT: config.js is gitignored - never commit your real keys!

const CONFIG = {
  // Your Supabase project URL (found in Project Settings > API)
  SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',

  // Your Supabase anon/public key (found in Project Settings > API > Project API keys)
  SUPABASE_ANON_KEY: 'your_supabase_anon_key',

  // Backend API URL for clustering
  API_URL: 'http://localhost:8000',

  // Maximum emails to fetch during onboarding
  MAX_EMAILS: 200,

  // Groq API key (for AI features)
  GROQ_API_KEY: 'your_groq_api_key',

  // Amplitude API key (for analytics)
  AMPLITUDE_API_KEY: 'your_amplitude_api_key'
};
