// Supabase Configuration
// 1. Copy this file to config.js
// 2. Fill in your Supabase values from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
//
// IMPORTANT: config.js is gitignored - never commit your real keys!

const CONFIG = {
  // Your Supabase project URL (found in Project Settings > API)
  SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',

  // Your Supabase anon/public key (found in Project Settings > API > Project API keys)
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',

  // Maximum emails to fetch during onboarding
  MAX_EMAILS: 200
};
