# Mediapark

Mediapark is an all-in-one creative and entertainment platform concept, built with **React, TypeScript and Vite**.

## Frontend status

The first responsive React frontend is in place. It includes:

- A creator-focused home dashboard and navigation
- A visual hero for the creative studio
- Cards for AI music, audio recording/editing, video editing, image editing, games, and live news
- A discovery feed preview for video, audio and news posts
- Trending topics and a live-news preview panel
- Responsive layouts for desktop, tablet and mobile
- Interactive frontend states for search, likes, saved posts, media-category navigation and feature notices

The first page is a **frontend prototype**. Search now filters the tool cards and discovery posts; Videos, Music and Live news filter the feed; Saved collects bookmarked preview posts. These interactions are currently in-memory only. The buttons and cards do not yet connect to AI generation, media processing, live broadcasts, game services, accounts, messaging or calling.

## Run locally

Install a recent version of Node.js, then run:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in your terminal.

To create a production build:

```bash
npm run build
```

## Project structure

- `src/App.tsx` — React components and page interactions
- `src/index.css` — responsive styles and visual design
- `src/main.tsx` — React entry point
- `index.html` — minimal Vite entry shell
- `vite.config.ts` — Vite configuration

The interface is built with React components rather than writing the page layout as a large plain HTML document. Vite still requires a minimal HTML shell to mount the React application.

## Roadmap

1. **In progress:** refine the frontend with functional media-category navigation, tool search and saved-post interactions.
2. Add authentication and creator profiles.
3. Build upload and content-feed workflows.
4. Integrate approved AI music and media-processing services.
5. Add secure media storage, moderation and search.
6. Add realtime messaging, audio/video calling and live streaming.
7. Add tests, deployment and security controls.

Keep API keys and other secrets on the server in environment variables. Never commit secrets to this repository.
