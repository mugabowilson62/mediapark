import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AudioLines, Bell, ChevronDown, ChevronRight, Compass, Gamepad2,
  Headphones, Image, Menu, MessageCircle, Mic2, MonitorPlay, Music2,
  Newspaper, Plus, Search, Settings2, Sparkles, TrendingUp,
  Video, WandSparkles, X, Play, Radio, Heart, Bookmark, Send,
} from "lucide-react";

type Feature = {
  title: string;
  description: string;
  icon: typeof Music2;
  label: string;
  tone: string;
};

const features: Feature[] = [
  { title: "AI Music Studio", description: "Turn a simple idea into your next sound.", icon: WandSparkles, label: "CREATE", tone: "violet" },
  { title: "Audio workshop", description: "Record vocals, layer tracks and polish audio.", icon: AudioLines, label: "RECORD", tone: "pink" },
  { title: "Video editor", description: "Build stories from clips, scenes and moments.", icon: Video, label: "EDIT", tone: "blue" },
  { title: "Image lab", description: "Design covers, posters and standout visuals.", icon: Image, label: "DESIGN", tone: "orange" },
  { title: "Game zone", description: "Take a break and discover something fun.", icon: Gamepad2, label: "PLAY", tone: "green" },
  { title: "Live & news", description: "Catch headlines, streams and what's happening.", icon: Radio, label: "WATCH", tone: "cyan" },
];

const feedItems = [
  { name: "Nia Creates", handle: "@niacreates", time: "12 min ago", title: "A little sunset, a little sound 🌅", kind: "VIDEO", icon: Video, tone: "feed-art-one", likes: "2.4k" },
  { name: "Kivu Sound", handle: "@kivusound", time: "38 min ago", title: "New beat idea — late night in Kigali", kind: "AUDIO", icon: Headphones, tone: "feed-art-two", likes: "986" },
  { name: "World Brief", handle: "@worldbrief", time: "1 hr ago", title: "The stories people are talking about today", kind: "NEWS", icon: Newspaper, tone: "feed-art-three", likes: "1.2k" },
];

function readStoredList(key: string): string[] {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function App() {
  const [activeNav, setActiveNav] = useState("Home");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [liked, setLiked] = useState<string[]>(() => readStoredList("mediapark:liked"));
  const [saved, setSaved] = useState<string[]>(() => readStoredList("mediapark:saved"));
  const [musicStudioOpen, setMusicStudioOpen] = useState(false);
  const [tracks, setTracks] = useState<Array<{ name: string; url: string }>>([]);
  const [currentTrack, setCurrentTrack] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem("mediapark:liked", JSON.stringify(liked));
    } catch {
      // Keep the interface usable when browser storage is unavailable.
    }
  }, [liked]);

  useEffect(() => {
    try {
      window.localStorage.setItem("mediapark:saved", JSON.stringify(saved));
    } catch {
      // Keep the interface usable when browser storage is unavailable.
    }
  }, [saved]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(""), 4800);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
        setNotice("");
      }
    };
    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, []);

  const showNotice = (name: string) => {
    setNotice(name + " is part of the Mediapark plan. This is the first frontend preview; its service will be connected in a later step.");
  };

  const navGroups = [
    { label: "EXPLORE", items: [
      { name: "Home", icon: Compass }, { name: "Discover", icon: TrendingUp }, { name: "Videos", icon: MonitorPlay }, { name: "Music", icon: Headphones }, { name: "Live news", icon: Newspaper },
    ]},
    { label: "CREATE", items: [
      { name: "AI music", icon: Sparkles }, { name: "Audio studio", icon: Mic2 }, { name: "Video studio", icon: Video }, { name: "Image lab", icon: Image },
    ]},
    { label: "YOUR SPACE", items: [
      { name: "Messages", icon: MessageCircle }, { name: "Saved", icon: Bookmark }, { name: "Games", icon: Gamepad2 }, { name: "Settings", icon: Settings2 },
    ]},
  ];

  const visibleFeedItems = feedItems.filter((item) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || (item.title + " " + item.name + " " + item.handle + " " + item.kind).toLowerCase().includes(query);
    const matchesSection =
      activeNav === "Videos" ? item.kind === "VIDEO" :
      activeNav === "Music" ? item.kind === "AUDIO" :
      activeNav === "Live news" ? item.kind === "NEWS" :
      activeNav === "Saved" ? saved.includes(item.name) :
      true;
    return matchesSearch && matchesSection;
  });

  const visibleFeatures = features.filter(({ title, description }) => {
    const query = search.trim().toLowerCase();
    return !query || (title + " " + description).toLowerCase().includes(query);
  });

  const sidebar = (
    <aside className="sidebar">
      <a className="brand" href="#top" onClick={() => setActiveNav("Home")}>
        <span className="brand-mark"><AudioLines size={22} strokeWidth={2.5} /><i aria-hidden="true">🦋</i></span>
        <span>media<span className="brand-light">park</span><small>YOUR CREATIVE UNIVERSE</small></span>
      </a>
      <button className="create-button" onClick={() => showNotice("Create new project")}><Plus size={18} /> Create something <span>↗</span></button>
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.items.map(({ name, icon: Icon }) => (
            <button className={"nav-item " + (activeNav === name ? "active" : "")} aria-current={activeNav === name ? "page" : undefined} key={name} onClick={() => { setActiveNav(name); setMobileOpen(false); if (!["Home", "Discover", "Videos", "Music", "Live news", "Saved"].includes(name)) showNotice(name); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{name}</span>{name === "Messages" && <i className="unread-dot" />}
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-bottom">
        <div className="upgrade-card"><span className="wildlife-decoration upgrade-wildlife" aria-hidden="true">🦒 🦓</span><div className="upgrade-icon"><Sparkles size={17} /></div><strong>Your ideas, amplified.</strong><p>Your creative space is just getting started.</p><button onClick={() => showNotice("Creator account")}>Explore creator tools <ChevronRight size={15} /></button></div>
        <button className="profile-row" onClick={() => showNotice("Profile and account")}><div className="avatar avatar-me">W</div><span><b>Wilson</b><small>Creator account</small></span><ChevronDown size={16} /></button>
      </div>
    </aside>
  );

  return (
    <div className="app-shell" id="top">
      {mobileOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      {sidebar}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><b>{activeNav}</b></div>
          <div className="top-actions">
            <label className="search-box"><Search size={17} /><input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Mediapark" aria-label="Search Mediapark" /><kbd>⌘ K</kbd></label>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => showNotice("Notifications")}><Bell size={18} /><i /></button>
            <button className="avatar avatar-top" aria-label="Open profile" onClick={() => showNotice("Profile")}>W</button>
          </div>
        </header>

        <div className="page-content">
          {musicStudioOpen && <section className="music-studio" aria-labelledby="music-studio-title">
            <div className="music-studio-heading">
              <div><div className="overline">PHASE 2 · FIRST WORKING MEDIA TOOL</div><h2 id="music-studio-title">Your Music Studio</h2><p>Play audio files from your device in this browser. Your files stay on your device.</p></div>
              <button className="icon-button" onClick={() => setMusicStudioOpen(false)} aria-label="Close music studio"><X size={18} /></button>
            </div>
            <label className="music-upload">
              <Plus size={18} /> Add audio files
              <input type="file" accept="audio/*" multiple onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                const additions = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
                setTracks((previous) => {
                  const next = [...previous, ...additions];
                  if (previous.length === 0 && additions.length > 0) setCurrentTrack(0);
                  return next;
                });
                event.currentTarget.value = "";
              }} />
            </label>
            {tracks.length === 0 ? <div className="music-empty"><Headphones size={30} /><b>Your playlist starts here</b><span>Choose MP3, WAV, M4A, or another audio file supported by your browser.</span></div> : <>
              <div className="music-now-playing"><span className="music-playing-icon"><AudioLines size={22} /></span><div><small>NOW PLAYING</small><b>{tracks[currentTrack]?.name ?? "Select a track"}</b></div></div>
              {tracks[currentTrack] && <audio className="music-audio" controls preload="metadata" src={tracks[currentTrack].url} />}
              <div className="music-playlist"><h3>Playlist <span>{tracks.length} {tracks.length === 1 ? "track" : "tracks"}</span></h3>
                {tracks.map((track, index) => <div className={"music-track " + (index === currentTrack ? "selected" : "")} key={track.url}>
                  <button onClick={() => setCurrentTrack(index)} aria-current={index === currentTrack ? "true" : undefined}><span className="track-number">{index === currentTrack ? <AudioLines size={15} /> : String(index + 1).padStart(2, "0")}</span><span className="track-name">{track.name}</span><span className="track-select">{index === currentTrack ? "Selected" : "Play"}</span></button>
                  <button className="track-remove" aria-label={"Remove " + track.name} onClick={() => { URL.revokeObjectURL(track.url); setTracks((previous) => previous.filter((_, i) => i !== index)); setCurrentTrack((current) => current > index ? current - 1 : current >= tracks.length - 1 && index === current ? Math.max(0, current - 1) : current); }}>×</button>
                </div>)}
              </div>
            </>}
            <p className="music-note">This is a local audio player, not AI music generation yet. Sign-in and cloud uploads will come in later phases.</p>
          </section>}
          {notice && <div className="notice-banner" role="status"><Sparkles size={17} /><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={16} /></button></div>}
          {search.trim() && <div className="search-result-note">Search preview for <b>“{search}”</b> — full search will be connected later.</div>}

          <section className="welcome-row">
            <div><div className="date-label"><span className="live-dot" /> YOUR WORLD, ALL IN ONE PLACE</div><h1>Make room for <span>your next big thing.</span></h1><p>Create something new, find your next favorite, or catch up with your world.</p></div>
            <div className="welcome-side"><span className="welcome-wildlife" aria-label="Park wildlife">🦁 <span>🐘</span> 🦒</span><button className="secondary-button welcome-action" onClick={() => showNotice("Quick create")}><Plus size={17} /> Quick create</button></div>
          </section>

          <section className="hero-panel">
            <div className="hero-copy">
              <div className="hero-pill"><Sparkles size={14} /> INTRODUCING YOUR CREATIVE SPACE</div>
              <h2>Your imagination.<br /><span>No limits.</span></h2>
              <p>From the first beat to the final frame, bring your ideas to life with tools made for curious minds.</p>
              <div className="hero-actions"><button className="primary-button" onClick={() => showNotice("AI Music Studio")}><WandSparkles size={17} /> Start creating <ChevronRight size={17} /></button><button className="text-button" onClick={() => showNotice("Studio tour")}>Take a tour <Play size={14} fill="currentColor" /></button></div>
              <div className="hero-foot"><span><span className="mini-avatar mini-one">N</span><span className="mini-avatar mini-two">K</span><span className="mini-avatar mini-three">A</span></span><small>Made for makers, listeners & storytellers</small></div>
            </div>
            <div className="hero-art" aria-label="Forest-inspired creative artwork with wildlife">
              <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-glow" />
              <div className="art-label"><span className="equalizer"><i /><i /><i /><i /></span> FOREST CREATIVE STUDIO <span className="art-live">● READY</span></div>
              <div className="art-disc"><div className="disc-core"><AudioLines size={42} /></div></div>
              <div className="sound-wave">{Array.from({ length: 37 }, (_, i) => <i key={i} style={{ "--bar-height": (18 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.17)) * 76) + "px", "--bar-delay": (i * 0.035) + "s" } as CSSProperties & { "--bar-height": string; "--bar-delay": string }} />)}</div>
              <div className="animal-strip" aria-label="Park wildlife: lion, elephant, giraffe, zebra, gorilla, rhino, hippo, buffalo, antelope, crocodile, monkey, parrot, flamingo, butterfly and birds">🌿 🦁 🐘 🦒 🦓 🦍 🦏 🦛 🐃 🦌 🐊 🐒 🦜 🦩 🦋 🐦</div>
              <div className="floating-card floating-top"><span className="float-icon purple"><Music2 size={17} /></span><span><b>Find your sound</b><small>AI Music Studio</small></span><ChevronRight size={15} /></div>
              <div className="floating-card floating-bottom"><span className="float-icon peach"><Video size={17} /></span><span><b>Tell your story</b><small>Creator tools</small></span><span className="float-play"><Play size={12} fill="currentColor" /></span></div>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><div className="overline">YOUR TOOLKIT</div><h2>What are we making today?</h2><p>A whole creative universe, one place to start.</p></div><button className="subtle-link" onClick={() => showNotice("All tools")}>Explore all tools <ChevronRight size={16} /></button></div>
            <div className="feature-grid">{visibleFeatures.map(({ title, description, icon: Icon, label, tone }) => <button className="feature-card" key={title} onClick={() => title === "AI Music Studio" ? setMusicStudioOpen(true) : showNotice(title)}><div className="feature-card-top"><span className="feature-wildlife" aria-hidden="true">{title === "AI Music Studio" ? "🦜" : title === "Audio workshop" ? "🐒" : title === "Video editor" ? "🦓" : title === "Image lab" ? "🦋" : title === "Game zone" ? "🐸" : "🦩"}</span><span className={"feature-icon " + tone}><Icon size={21} /></span><span className={"feature-label " + tone}>{label}</span></div><h3>{title}</h3><p>{description}</p><span className="feature-link">Open workspace <ChevronRight size={15} /></span></button>)}{visibleFeatures.length === 0 && <div className="empty-state">No tools match “{search}”. Try another search.</div>}</div>
          </section>

          <section className="section-block discover-section">
            <div className="section-heading"><div><div className="overline">THE COMMUNITY</div><h2>There's a world to discover.</h2><p>Fresh videos, new sounds and stories worth your time.</p></div><button className="subtle-link" onClick={() => setActiveNav("Discover")}>Open discover feed <ChevronRight size={16} /></button></div>
            <div className="discover-layout">
              <div className="feed-list">{visibleFeedItems.map((item) => { const Icon = item.icon; const isLiked = liked.includes(item.name); return <article className="feed-card" key={item.name}><div className={"feed-art " + item.tone}><span className="feed-kind"><Icon size={13} /> {item.kind}</span><span className="feed-wildlife" aria-hidden="true">{item.kind === "VIDEO" ? "🦓" : item.kind === "AUDIO" ? "🦜" : "🦉"}</span><span className="feed-art-symbol">{item.kind === "VIDEO" ? <Play size={34} fill="currentColor" /> : item.kind === "AUDIO" ? <AudioLines size={46} /> : <Newspaper size={43} />}</span><span className="feed-art-caption">{item.kind === "VIDEO" ? "MOMENTS IN MOTION" : item.kind === "AUDIO" ? "SOUND OF THE CITY" : "THE DAILY EDIT"}</span></div><div className="feed-body"><div className="feed-author"><div className={"avatar " + (item.kind === "AUDIO" ? "avatar-kivu" : item.kind === "NEWS" ? "avatar-news" : "avatar-nia")}>{item.name.charAt(0)}</div><div><b>{item.name}</b><small>{item.handle} · {item.time}</small></div><button className="more-button" onClick={() => showNotice("More options")} aria-label="More options">•••</button></div><h3>{item.title}</h3><div className="feed-actions"><button className={isLiked ? "liked" : ""} aria-label={isLiked ? `Unlike ${item.name} post` : `Like ${item.name} post`} aria-pressed={isLiked} onClick={() => setLiked((prev) => isLiked ? prev.filter((n) => n !== item.name) : [...prev, item.name])}><Heart size={16} fill={isLiked ? "currentColor" : "none"} /> {isLiked ? "Liked" : item.likes}</button><button onClick={() => showNotice("Comments")}><MessageCircle size={16} /> Comment</button><button className={saved.includes(item.name) ? "saved" : ""} aria-pressed={saved.includes(item.name)} onClick={() => setSaved((prev) => saved.includes(item.name) ? prev.filter((n) => n !== item.name) : [...prev, item.name])} aria-label={saved.includes(item.name) ? "Remove saved post" : "Save post"} title={saved.includes(item.name) ? "Saved" : "Save post"}><Bookmark size={16} fill={saved.includes(item.name) ? "currentColor" : "none"} /></button><button onClick={() => showNotice("Share post")} aria-label="Share post"><Send size={15} /></button></div></div></article>; })}{(search.trim() || activeNav === "Videos" || activeNav === "Music" || activeNav === "Live news" || activeNav === "Saved") && visibleFeedItems.length === 0 && <div className="empty-state">{activeNav === "Saved" ? "You have not saved any posts yet." : `No ${activeNav === "Home" || activeNav === "Discover" ? "preview posts" : activeNav.toLowerCase() + " posts"} match this view. Try another search.`}</div>}</div>
              <aside className="right-column">
                <div className="side-panel trending-panel"><div className="side-title"><h3><TrendingUp size={17} /> Trending now</h3><button onClick={() => showNotice("Trending topics")}>See all</button></div><button className="trend-row" onClick={() => showNotice("AI music trend")}><span className="trend-number">01</span><span className="trend-wildlife" aria-hidden="true">🦜</span><span><b>#AIMusic</b><small>Creativity meets technology</small></span><ChevronRight size={15} /></button><button className="trend-row" onClick={() => showNotice("Creator trend")}><span className="trend-number">02</span><span className="trend-wildlife" aria-hidden="true">🦁</span><span><b>#MadeInAfrica</b><small>Stories from the continent</small></span><ChevronRight size={15} /></button><button className="trend-row" onClick={() => showNotice("Short video trend")}><span className="trend-number">03</span><span className="trend-wildlife" aria-hidden="true">🦓</span><span><b>#ShortFilm</b><small>Big ideas in small frames</small></span><ChevronRight size={15} /></button></div>
                <div className="side-panel live-panel"><div className="live-visual"><span className="live-wildlife" aria-hidden="true">🦩 🦢</span><div className="live-rings"><Radio size={28} /></div><span className="live-badge"><i /> LIVE & NEWS</span></div><div className="live-copy"><h3>Stay in the know.</h3><p>Make space for live broadcasts, headlines and stories from around the world.</p><button className="primary-button small-button" onClick={() => showNotice("Live news")}>Explore live news <ChevronRight size={15} /></button></div></div>
                <div className="tip-panel"><span className="tip-wildlife" aria-hidden="true">🦔</span><span className="tip-icon"><Sparkles size={17} /></span><div><b>Your next idea starts here</b><p>Pick a tool, try a new format, and make something that's yours.</p></div></div>
              </aside>
            </div>
          </section>
          <footer className="page-footer"><span className="footer-wildlife" aria-label="Wildlife">🦋 🐢 🐦</span><span>© 2026 Mediapark</span><span>Built for your creative universe <Sparkles size={13} /></span><button onClick={() => showNotice("Feedback")}>Send feedback</button></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
