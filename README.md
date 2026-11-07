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

## Public holidays and reminders

The holiday calendar starts with India selected. India dates for 2026–2030 are bundled from [Google's public “Holidays in India” calendar](https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics); regional observances and tentative religious dates can differ from local government notifications. The Tasks page lets you choose the United States, United Kingdom, Canada, or Australia, which load from [Nager.Date](https://date.nager.at/).

To receive event reminders, open **Tasks → Enable phone reminders**, allow notifications in the browser or phone settings, and choose a reminder when creating an event. The app must be served over HTTPS (localhost is also supported). On iOS, install the site to the Home Screen and use iOS 16.4 or newer. Notifications are scheduled while the app is open. Delivery after the app/browser has been fully closed requires a push-notification service and server-side push credentials, which this project does not currently have.
