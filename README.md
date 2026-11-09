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
- **Video studio** (Create → Video studio, or the Video editor card): a multi-track video editor that runs in the browser

## Video studio

A working, browser-only video editor. It starts empty: you bring your own video, music and photos.

- **Import** by button, by dragging files anywhere into the window, or by dropping them straight onto a track. Drag items from the media panel onto the timeline, or click them to add at the playhead.
- **Timeline** with Text, Video and Audio tracks. Add more video and audio tracks with the + buttons (up to 4 of each). Drag clips to move them (also between tracks of the same kind), drag their edges to trim, and snap to the playhead and other clips. Real video thumbnails and audio waveforms are drawn on the clips.
- **Editing:** split, duplicate, delete (Shift+Delete closes the gap), detach audio from a video, undo and redo, zoom (slider, +/-, Ctrl+scroll, fit to window), hide, mute and lock tracks.
- **Per clip:** name, speed (0.25x to 4x), volume, opacity, fade in and out, fit or fill, zoom.
- **Text:** center title, lower third and subtitle, with your own text, colour and size.
- **Frame shapes:** 16:9, 9:16 and 1:1.
- **Export** renders the timeline (video, photos, text, mixed audio, fades, speed) to a real MP4 or WebM file at 480p, 720p or 1080p, and lets you preview and download it. Export runs in real time, so keep the tab open while it works.
- **Autosave:** the project and imported files are kept in this browser (IndexedDB). Nothing is uploaded anywhere.
- **Shortcuts:** `Space` play or pause, `S` split, `Delete` remove, `Shift+Delete` remove and close the gap, `←` `→` step one frame (`Shift` for one second), `Home` and `End`, `Ctrl/⌘+Z` undo, `Ctrl/⌘+D` duplicate, `+` `-` zoom.

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
- `src/VideoStudio.tsx` — the video editor interface (timeline, preview, inspector)
- `src/studio/` — editor logic: `types.ts`, `utils.ts` (import, thumbnails, waveforms), `storage.ts` (autosave), `exporter.ts` (video export)
- `src/videostudio.css` — video editor styling
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
