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

## Studio layout

The Video studio and Audio studio are desktop-style workspaces. On screens wider than 900px the whole editor fits inside one window with no page scrolling: the top bar stays put, and the media panel, inspector, effects panel and timeline each scroll on their own. On narrow screens the panels stack and the page scrolls normally.

## Video studio

A working, browser-only video editor. It starts empty: you bring your own video, music and photos.

- **Import** by button, by dragging files anywhere into the window, or by dropping them onto a track. Drag items from the media panel onto the timeline, or click them to add at the playhead.
- **Timeline** with Text, Video and Audio tracks, plus extra video and audio tracks (up to 4 of each). Drag clips to move them, drag edges to trim, and snap to the playhead and other clips. Real video thumbnails and audio waveforms are drawn on the clips.
- **Editing:** split, duplicate, delete (Shift+Delete closes the gap), detach audio, undo and redo, zoom, hide, mute and lock tracks.
- **Per clip:** name, speed (0.25x to 4x), volume, opacity, fades, fit or fill, zoom. **Text:** center title, lower third and subtitle with your own wording, colour and size.
- **Export** renders the whole timeline (edits, trims, speed, every video, photo, text and audio track, overlays, fades and mixed sound) to a real video file at 480p, 720p or 1080p. MP4 is offered where the browser can record it, otherwise WebM. The result can be previewed and downloaded. Export runs in real time, so keep the tab open while it works.
- **Autosave** keeps the project and imported files in this browser (IndexedDB). Nothing is uploaded.
- **Shortcuts:** `Space` play or pause, `S` split, `Delete` remove, `Shift+Delete` remove and close the gap, arrows step a frame (`Shift` for a second), `Home`/`End`, `Ctrl/⌘+Z` undo, `Ctrl/⌘+D` duplicate, `+`/`-` zoom.

## Audio studio

A multitrack audio workspace (Create → Audio studio, or the Audio workshop card).

- **Timeline editing:** cut, copy and paste clips at the playhead (`Ctrl/⌘+X`, `C`, `V`), split at the playhead (`S`), trim by dragging clip edges or with Trim start / Trim end to the playhead, and fade in and out with draggable round handles at the clip corners (or exact values in the Clip tab).
- **Multitrack mixing:** Voiceover, Music and SFX tracks play together, with room for more. Each track has a volume fader (0 to 100), a pan control (L to R, double-click to centre), and Mute and Solo buttons. A level meter shows the master output.
- **Effects (per track, applied live while playing):** 3-band equalizer (bass, mid, treble); noise reduction (a noise gate plus hiss filter, and a 50 or 60 Hz mains-hum filter); a compressor; reverb (room presets and size, plus mix); and delay (time, feedback, mix).
- **Recording:** record a voiceover from your microphone straight onto the selected track. Use headphones when other tracks are playing.
- **Export** mixes down offline with every setting applied. Formats are **WAV** (16-bit), **MP3** and **AAC**, at 44.1 or 48 kHz, with optional loudness normalisation. Title, artist, album, year and genre are written into the file: WAV uses a RIFF INFO block, MP3 and AAC use ID3 tags.
  - MP3 encoding uses the `lamejs` encoder, which is downloaded from cdnjs (version pinned) the first time you export an MP3, so MP3 export needs an internet connection. WAV and AAC do not.
  - AAC depends on the browser: Chrome and Edge on Windows and macOS provide a raw `.aac` encoder. Where only MediaRecorder can do it, the file is saved as `.m4a` in real time without tags. If neither exists, the AAC option is disabled and MP3 or WAV can be used.
- **Autosave:** tracks, clips, effects, metadata and imported audio are kept in this browser.
- **Shortcuts:** `Space` play or pause, `S` split, `Ctrl/⌘+C/X/V` copy, cut, paste, `Delete` remove, `Ctrl/⌘+D` duplicate, arrows move the playhead (`Shift` for a second), `+`/`-` zoom.

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
- `src/AudioStudio.tsx`, `src/audiostudio.css` — the audio editor interface
- `src/audio/` — audio logic: `engine.ts` (effects chain, playback scheduling, offline mixdown), `encoders.ts` (WAV, MP3, AAC and metadata), `storage.ts` (autosave)
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
