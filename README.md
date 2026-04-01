## Muse Board

A polished first-pass moodboard web app built with Next.js and TypeScript.

### Current product surface

- Google-style entry screen that leads into the editor flow
- Multiple workspaces for different moodboard directions
- Large pan-and-zoom canvas with a restrained, Figma-inspired layout
- Drag-and-drop image imports straight onto the board
- Resizable image frames with crop offsets, crop zoom, corner radius, and shadow controls
- Text blocks with editable content, sizing, weight, alignment, and color
- Local persistence through `localStorage` so boards survive reloads
- Sharing/auth/sync architecture notes already shaped for Supabase

### Suggested production stack

- `Next.js` for the app shell
- `Supabase Auth` for Google login
- `Supabase Postgres` for workspaces, boards, layers, and permissions
- `Supabase Storage` for uploaded images
- `Supabase Realtime` for shared board presence and live sync

### Getting started

Run the dev server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Environment

When you are ready to wire real auth and syncing, copy `.env.example` and add:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Next build steps

1. Replace the demo sign-in action with real Supabase Google OAuth.
2. Move workspace and layer persistence from `localStorage` into Postgres.
3. Upload dropped images into Supabase Storage instead of keeping them as local data URLs.
4. Add collaborative cursors, comments, and permissions for shared boards.
5. Add richer canvas tools like alignment guides, grouping, layering, and board comments.

### Notes

This build intentionally gets the editor feel right first. The current sign-in button is a demo entry so we can shape the product flow before wiring backend credentials.
