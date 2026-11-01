# Calendar app

## Supabase setup

1. In the Supabase project dashboard, open **SQL Editor**, paste the contents of [`supabase/schema.sql`](./supabase/schema.sql), and run it. The table uses Row Level Security so each signed-in user can access only their own calendar data.
2. The local `.env.local` file contains this project's URL and publishable key. It is ignored by Git. For another environment, copy `.env.example` and fill in the project values.
3. In Supabase **Authentication → URL Configuration**, set the local site URL to `http://localhost:5173`. If email confirmation is enabled, allow that URL as a redirect and confirm the email before signing in.
4. Install dependencies and start the app with Node.js 22.12+:

   ```sh
   npm install
   npm run dev
   ```

Create an account in the app, then sign in. On the first sign-in for an account, existing calendar data in this browser is copied into that account's Supabase row. Later calendar changes sync automatically. Theme and display preferences remain in this browser.

The publishable key is intended for browser use. Never put a Supabase `service_role` key in this app; the database's Row Level Security policies enforce account-level access.
