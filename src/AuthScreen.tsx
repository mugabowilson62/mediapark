import { useState, type FormEvent } from "react";
import { AudioLines, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { supabase } from "./lib/supabase";

export default function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Account created. Check your email and confirm your address, then sign in.");
        } else {
          setMessage("Your account is ready. Welcome to MediaPark!");
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <a className="auth-brand" href="/" aria-label="MediaPark home">
          <span className="auth-brand-mark"><AudioLines size={23} /><i>🦋</i></span>
          <span>media<span>park</span></span>
        </a>
        <div className="auth-showcase-copy">
          <div className="auth-eyebrow"><Sparkles size={14} /> YOUR CREATIVE UNIVERSE</div>
          <h1>Make room for<br /><span>your next big thing.</span></h1>
          <p>One home for your videos, music, ideas and creative projects.</p>
          <div className="auth-animal-line" aria-hidden="true">🌿 🦁 🐘 🦒 🦓 🦋</div>
        </div>
        <div className="auth-showcase-foot">Create. Explore. Share your world.</div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-kicker">WELCOME TO MEDIAPARK</div>
          <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
          <p className="auth-subtitle">{mode === "signin" ? "Sign in to enter your creative workspace." : "Join MediaPark and unlock your creative workspace."}</p>

          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button type="button" className={mode === "signin" ? "selected" : ""} onClick={() => { setMode("signin"); setError(""); setMessage(""); }}>Sign in</button>
            <button type="button" className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setError(""); setMessage(""); }}>Create account</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="auth-email">Email address</label>
            <div className="auth-input-wrap"><Mail size={17} /><input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <label htmlFor="auth-password">Password</label>
            <div className="auth-input-wrap"><LockKeyhole size={17} /><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="At least 8 characters" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="auth-show-password" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {error && <div className="auth-feedback error" role="alert">{error}</div>}
            {message && <div className="auth-feedback success" role="status">{message}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait..." : mode === "signin" ? "Sign in to MediaPark" : "Create my account"} <ArrowRight size={17} /></button>
          </form>
          <p className="auth-security-note"><LockKeyhole size={14} /> Your account is secured by Supabase authentication.</p>
          <p className="auth-public-note">Just visiting? You can view the public home page after signing in to explore member features.</p>
        </div>
      </section>
    </main>
  );
}
