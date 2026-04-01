# Team Setup

This project is ready as a prototype. To use it with your team, you still need to connect:

1. GitHub
2. Vercel
3. Supabase
4. Google Login

## The simple order

1. Put the project on GitHub
2. Deploy it on Vercel
3. Create a Supabase project
4. Turn on Google login in Supabase
5. Add the Supabase keys in Vercel
6. Ask Codex to wire the real auth, sync, uploads, and sharing

## What each service does

- GitHub: stores your code
- Vercel: hosts the website
- Supabase: stores users, boards, images, and team data
- Google Login: lets your team sign in easily

## What you will need

- A GitHub account
- A Vercel account
- A Supabase account
- A Google account for Google Cloud

## Step 1. Put this project on GitHub

If you are new to this, the easiest way is:

1. Create a new repository on GitHub called `moodboard-studio`
2. Upload the contents of this folder
3. Make sure these files are included:
   - `src/`
   - `public/`
   - `package.json`
   - `README.md`
   - `TEAM_SETUP.md`
4. Do not upload:
   - `node_modules/`
   - `.next/`
   - `.env.local`

## Step 2. Deploy on Vercel

1. Log in to Vercel
2. Click `Add New Project`
3. Import your GitHub repo
4. Leave the framework as `Next.js`
5. Click `Deploy`

After this, you will get a live URL.

## Step 3. Create a Supabase project

1. Log in to Supabase
2. Click `New Project`
3. Give it a name like `moodboard-studio`
4. Save the database password somewhere safe
5. Wait for the project to finish creating

## Step 4. Turn on Google login

1. In Supabase, open `Authentication`
2. Open `Sign In / Providers`
3. Turn on `Google`
4. Copy the callback URL shown by Supabase

## Step 5. Create Google OAuth credentials

1. Open Google Cloud Console
2. Create a project
3. Go to `APIs & Services`
4. Open `Credentials`
5. Create an `OAuth client ID`
6. Add the Supabase callback URL as an authorized redirect URL
7. Copy the Google Client ID and Client Secret
8. Paste those into Supabase Google provider settings

## Step 6. Copy Supabase keys into Vercel

In Supabase, open `Settings` then `API`.

You will need:

- `Project URL`
- `anon public key`

In Vercel, open your project settings and add:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Then redeploy the app.

## Step 7. Ask Codex to wire the real backend

Once the accounts and keys are ready, ask:

`Wire Supabase auth, storage, database, and sharing into this app.`

At that point Codex can do the code work for:

- real Google login
- saved workspaces
- saved images
- shared boards
- team access rules

## Current limitation

Right now the login button is only a demo button. The app still needs real backend wiring before your team can use it properly.
