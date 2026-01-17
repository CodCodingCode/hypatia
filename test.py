import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

# Supabase connection
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_ANON_KEY")
supabase = create_client(supabase_url, supabase_key)

# User to delete
user_email = "nathanyan2008p@gmail.com"

# First, get the user's ID
user_response = supabase.table("users").select("id, email").eq("email", user_email).execute()

if not user_response.data:
    print(f"No user found with email: {user_email}")
else:
    user_id = user_response.data[0]["id"]
    print(f"Found user: {user_email} (ID: {user_id})")

    # Delete user - CASCADE will automatically delete:
    # - sent_emails (ON DELETE CASCADE)
    # - campaigns (ON DELETE CASCADE)
    # - email_campaigns (via CASCADE from sent_emails and campaigns)

    confirm = input(f"Are you sure you want to delete ALL data for {user_email}? (yes/no): ")

    if confirm.lower() == "yes":
        delete_response = supabase.table("users").delete().eq("id", user_id).execute()
        print(f"Deleted user {user_email} and all associated data.")
    else:
        print("Deletion cancelled.")
