# Weight Journey

A personal weight loss journal that runs in the browser. Log a daily weigh-in, the meals you ate, and the exercise you did, then watch the trend on the dashboard. Sign in to keep every device in sync.

No build step. The site is static HTML, CSS, and JavaScript, so it deploys straight to GitHub Pages. Data is kept in the browser's local storage and, when you are signed in, synced to a Supabase (Postgres) database behind row-level security.

## Features

- **Dashboard** with current weight, total change, 7-day change, and progress toward a goal weight
- **Weight trend chart** with a 7-day moving average, goal line, hover and keyboard tooltips, a 7/30/90-day/all range filter, and an accessible table view
- **Daily log** for one weigh-in per day, any number of meals (with optional calories), and any number of exercise sessions (minutes and optional calories)
- **Presets** for meals you eat often ("Morning coffee" logs the same calories every time, one tap) and for your usual exercises (tap to fill in the form, adjust the minutes, add). Save a preset from the log form with the "Save as preset" checkbox, or manage them in Settings.
- **Label scanner**: tap *Scan label*, photograph a package's Nutrition Facts panel, and the app reads the name, calories, protein, carbs, and fat on-device, then lets you check the values and save them as a preset (and log the meal right away). Handy for prepared meals such as Factor. OCR runs in the browser with Tesseract.js, loaded on first use; the photo never leaves your device.
- **Macros**: meals and presets carry optional protein, carbs, and fat in grams, with daily totals on the Log page and a column in History.
- **History** tables for every weigh-in, meal, and workout, with one-click removal
- **Account & sync**: email and password sign-in, offline-first sync across phones and computers, sync status in the header
- **Settings** for pounds or kilograms, goal weight, light/dark/system theme, JSON export and import, and a full reset
- Works on phones, with a bottom tab bar on small screens

## Run it locally

Open `index.html` directly in a browser, or serve the folder:

```sh
npx serve .
```

## Deploy to GitHub Pages

1. Create a new repository on GitHub (for example `weight-journey`).
2. Push this folder to it:

   ```sh
   git remote add origin https://github.com/<your-username>/weight-journey.git
   git branch -M main
   git push -u origin main
   ```

3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, then save.
5. After a minute the site is live at `https://<your-username>.github.io/weight-journey/`.

Because the app uses only relative paths, it works at any sub-path without configuration.

## Cloud sync (Supabase)

The connection details live in `js/config.js`. The publishable key is meant to be public: every table has row-level security, so a signed-in user can only read and write their own rows.

### One-time setup in the Supabase dashboard

Email confirmation and password reset links need to send people back to the app. In the Supabase dashboard for the project, open **Authentication → URL Configuration** and set:

- **Site URL**: your GitHub Pages address, for example `https://<your-username>.github.io/weight-journey/`
- **Redirect URLs**: add the same address

Until this is set, confirmation links land on a Supabase default page. The account is still confirmed and you can sign in from the app afterwards.

### How sync works

- The browser copy is always the working set, so the app is fully usable offline.
- Changes are queued locally and pushed about 1.5 seconds after you make them, and again when the tab becomes visible or the device comes back online.
- After a push, the full server copy is pulled and becomes the local copy, so deletions made on another device show up too.
- If the same entry was edited on two devices, the most recent edit wins.
- When you sign in on a device that already has data, that data is uploaded and merged.
- Theme is per device. Units and goal weight sync.

### Database schema

| Table | Key | Purpose |
|---|---|---|
| `weigh_ins` | `(user_id, date)` | One weight per day, stored in kg |
| `meals` | `id` | Meals with optional calories and protein/carbs/fat grams |
| `exercise` | `id` | Exercise sessions with minutes and optional calories |
| `meal_presets` | `id` | Saved meals for one-tap logging, with calories and macros |
| `exercise_presets` | `id` | Saved exercises with default minutes and calories |
| `user_settings` | `user_id` | Unit and goal weight |

Every table has a policy restricting all operations to `auth.uid() = user_id`.

## Project layout

```
index.html      Markup for all four views (dashboard, log, history, settings)
css/style.css   Styles and light/dark design tokens
js/config.js    Supabase URL and publishable key
js/app.js       State, storage, rendering, presets, and the SVG chart
js/sync.js      Sign-in, sign-up, password reset, and the sync engine
js/scan.js      Nutrition label scanner (on-device OCR and label parsing)
```

## Data and privacy

Local data is saved under one key in `localStorage` for the site's origin. Clearing site data removes the local copy; if you are signed in it comes back on the next sync. **Settings → Export backup** downloads everything as JSON, and imports can merge with or replace what is stored.

Weights are stored internally in kilograms and converted for display, so switching units never loses precision.
