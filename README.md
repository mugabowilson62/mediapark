# Mediapark

Mediapark is a creative and entertainment platform prototype built with **React, TypeScript and Vite**.

## Current frontend

The responsive frontend includes:

- A forest-green creative dashboard with wildlife accents
- Navigation for Home, Discover, Videos, Music, Live news and Saved
- Search across the tool cards and discovery feed
- Preview feed cards for video, audio and news
- Browser-persisted likes and saved posts
- Empty states, keyboard shortcuts and accessible button labels
- Responsive desktop, tablet and mobile styling

This is still a **frontend prototype**. Likes and saved posts are stored in the current browser using `localStorage`; they are not synced across accounts or devices. Search is a local preview filter, not a backend search service. AI generation, media processing, uploads, live broadcasts, games, accounts, messaging and calling are not connected yet. Buttons for those future services show a prototype notice.

## Live preview

The current hosting target is Render:

- https://mediapark.onrender.com/

Render should use a **Static Site** with build command `npm install && npm run build` and publish directory `dist`. The GitHub Actions workflow `.github/workflows/phase-1-build.yml` runs the TypeScript check and Vite production build on pushes to `main` and pull requests.

## Run locally

Use Node.js 20 or newer:

```bash
npm install
npm run dev
```

To run the production build check:

```bash
npm run build
```

## Project structure

- `src/App.tsx` — page layout and frontend interactions
- `src/index.css` — visual design and responsive styling
- `src/main.tsx` — React entry point
- `index.html` — Vite HTML shell
- `vite.config.ts` — Vite configuration

## Roadmap

1. **Phase 1 — frontend foundation:** responsive layout, navigation, search, browser-persisted likes and saved posts, empty states, keyboard shortcuts, accessibility labels, and automated build check.
2. Add authentication and creator profiles.
3. Build upload and content-feed workflows.
4. Integrate approved AI music and media-processing services.
5. Add secure media storage, moderation and search.
6. Add realtime messaging, audio/video calling and live streaming.
7. Expand automated browser tests and security controls.

Keep API keys and other secrets on the server in environment variables. Never commit secrets to this repository.
