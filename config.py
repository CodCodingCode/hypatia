"""
Configuration module for Hypatia project.

Loads environment variables from .env file and exposes them as module-level constants.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# OpenAI Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
MODEL = os.getenv("MODEL", "gpt-4.1-nano").strip()

# Aviato API Configuration
AVIATO_API_KEY = os.getenv("AVIATO_API_KEY", "").strip()
AVIATO_BASE_URL = os.getenv("AVIATO_BASE_URL", "https://data.api.aviato.co").strip()

# Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()

# Google Cloud Configuration
GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
PUBSUB_SUBSCRIPTION = os.getenv("PUBSUB_SUBSCRIPTION", "").strip()

# Other API Keys
BACKBOARD_API_KEY = os.getenv("BACKBOARD_API_KEY", "").strip()
CLADO_API_KEY = os.getenv("CLADO_API_KEY", "").strip()
