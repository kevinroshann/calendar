import React, { useState, useMemo, useEffect, useRef } from "react";
import AuthScreen from "./AuthScreen";
import supabase from "./supabase";

/* ---------- date helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); x.setDate(Math.min(d.getDate(), 28)); return x; };
const startOfWeek = (d) => addDays(d, -d.getDay());
const same = (a, b) => dk(a) === dk(b);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const decadeOf = (y) => Math.floor(y / 10) * 10;
const monthGrid = (y, m) => { const s = startOfWeek(new Date(y, m, 1)); return Array.from({ length: 42 }, (_, i) => addDays(s, i)); };
const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""} ${h < 12 ? "AM" : "PM"}`; };
const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

const DEFAULT_CALS = [
  { id: "my", name: "My calendar", color: "#6366f1" },
  { id: "work", name: "Work", color: "#10b981" },
  { id: "family", name: "Family", color: "#f43f5e" },
  { id: "birthdays", name: "Birthdays", color: "#f59e0b" },
];
const normalizeCalendars = (saved = []) => {
  const ids = new Set(DEFAULT_CALS.map((calendar) => calendar.id));
  const custom = Array.isArray(saved) ? saved.flatMap((calendar) => {
    if (!calendar || typeof calendar.id !== "string" || ids.has(calendar.id)) return [];
    const name = typeof calendar.name === "string" ? calendar.name.trim() : "";
    if (!name) return [];
    ids.add(calendar.id);
    return [{
      id: calendar.id,
      name,
      color: typeof calendar.color === "string" && /^#[\da-f]{6}$/i.test(calendar.color) ? calendar.color : "#6366f1",
      custom: true,
    }];
  }) : [];
  return [...DEFAULT_CALS, ...custom];
};
const LEVELS = [["day", "Day"], ["month", "Month"], ["year", "Year"], ["decade", "Decade"]];
const goalKey = (level, d) =>
  level === "day" ? dk(d) : level === "month" ? dk(d).slice(0, 7) : level === "year" ? String(d.getFullYear()) : String(decadeOf(d.getFullYear()));

const VIEWS = [["day","Day","D"],["week","Week","W"],["month","Month","M"],["year","Year","Y"],["decade","Decade","X"],["twenty","20 years","T"],["custom","Custom range","C"],["life","Life in weeks","L"]];

const BIRTH = new Date(2006, 6, 17);
const ageOn = (d) => d.getFullYear() - 2006 - (d < new Date(d.getFullYear(), 6, 17) ? 1 : 0);
const yearAge = (y) => (y < 2006 ? "Before you" : y === 2006 ? "Born Jul 17" : `${y - 2007} → ${y - 2006}`);
const monthAge = (y, m) => y - 2006 - (m < 6 ? 1 : 0);
const decAge = (ds) => (ds + 9 < 2006 ? "Before you were born" : `Ages ${Math.max(0, ds - 2007)}–${ds + 9 - 2006}`);
const lastDay = (y, m) => dk(new Date(y, m + 1, 0));
const overlaps = (i, a, b) => i.start <= b && i.end >= a;
const late = (i) => !i.done && i.kind !== "schedule" && i.kind !== "challenge" && i.end < dk(new Date());
const MILE = [18, 21, 25, 30, 40, 50, 60, 70, 80];
const DEMO_RECORDS = {
  events: [[1, "Team standup"], [2, "Lunch with Anna"], [3, "Family trip"]],
  goals: [[1, "Finish the report"], [2, "Read 2 books"], [3, "Run a half marathon"], [4, "Buy a house"]],
  items: [[1, "College semester"], [2, "Renew passport"], [3, "Learn guitar"], [4, "Summer trip"]],
};
const removeDemoRecords = (data) => ({
  ...data,
  ...Object.fromEntries(
    ["events", "goals", "items", "challenges"].map((kind) => [
      kind,
      (Array.isArray(data[kind]) ? data[kind] : []).filter((item) =>
        !DEMO_RECORDS[kind]?.some(([id, title]) => item.id === id && item.title === title)),
    ]),
  ),
});
/* challenges: {id,title,start,days,note,checks:[YYYY-MM-DD]} */
const cEnd = (c) => dk(addDays(parse(c.start), c.days - 1));
const cActive = (c, k) => c.start <= k && k <= cEnd(c);
const cDay = (c, k) => Math.round((parse(k) - parse(c.start)) / 864e5) + 1;
const cStats = (c) => {
  const t = dk(new Date()), end = cEnd(c), set = new Set(c.checks);
  const inRange = c.checks.filter((k) => k >= c.start && k <= end).length;
  const upcoming = t < c.start, finished = t > end;
  const dayNo = upcoming ? 0 : finished ? c.days : cDay(c, t);
  const past = finished ? c.days : Math.max(0, dayNo - 1);
  const checkedPast = c.checks.filter((k) => k >= c.start && k <= end && k < t).length;
  let d = parse(upcoming ? c.start : finished ? end : t), streak = 0;
  if (!upcoming && !finished && !set.has(dk(d))) d = addDays(d, -1);
  while (dk(d) >= c.start && set.has(dk(d))) { streak++; d = addDays(d, -1); }
  return { inRange, dayNo, streak, missed: Math.max(0, past - checkedPast), pct: Math.min(1, inRange / c.days), upcoming, finished, complete: inRange >= c.days };
};
const load = (k, d) => { try { const v = localStorage.getItem("gc-" + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const KIND = { goal: ["Goal", "#f59e0b"], task: ["Task", "#10b981"], schedule: ["Schedule", "#6366f1"], challenge: ["Challenge", "#ec4899"] };
function useDrag(done) {
  const [sel, setSel] = useState(null);
  const ref = useRef(null); ref.current = sel;
  useEffect(() => {
    const up = () => { const s = ref.current; if (s) { setSel(null); done(s.a < s.b ? s.a : s.b, s.a < s.b ? s.b : s.a, s.a === s.b); } };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  });
  const lo = sel && (sel.a < sel.b ? sel.a : sel.b), hi = sel && (sel.a < sel.b ? sel.b : sel.a);
  return { down: (k) => setSel({ a: k, b: k }), over: (k) => setSel((s) => s && { ...s, b: k }), inSel: (k) => !!sel && k >= lo && k <= hi };
}

const today = new Date();
const IC = {
  menu: "M4 7h16M4 12h16M4 17h16", search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  moon: "M20.5 14A8.5 8.5 0 1 1 10 3.5 6.5 6.5 0 0 0 20.5 14z", sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  left: "M15 5l-7 7 7 7", x: "M6 6l12 12M18 6L6 18", right: "M9 5l7 7-7 7", down: "M6 9l6 6 6-6", refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4zM9 15a2 2 0 1 0 0 4 2 2 0 1 0 0-4z",
  plus: "M12 5v14M5 12h14",
  quote: "M15.5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM4.5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
  check: "M5 12.5l4.5 4.5L19 7.5", ext: "M7 17L17 7M8 7h9v9",
  panel: "M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM15 4v16",
  trash: "M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5m4-5v5",
  focus: "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3",
  shrink: "M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};
const Ic = ({ n, s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={IC[n]} /></svg>;
const fmtK = (k) => (k.length === 7 ? `${MONTHS[+k.slice(5) - 1].slice(0, 3)} ${k.slice(0, 4)}` : parse(k).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
function Seg({ value, onChange, options, className = "" }) {
  const i = Math.max(0, options.findIndex(([k]) => k === value));
  return (
    <div className={"iseg " + className} style={{ "--n": options.length, "--i": i }} role="tablist">
      <span className="thumb" />
      {options.map(([k, n]) => <button key={k} role="tab" aria-selected={k === value} className={k === value ? "on" : ""} onClick={() => onChange(k)}>{n}</button>)}
    </div>
  );
}
function SelBar({ sel, onClose, openRange, onOpen, openLabel }) {
  const single = sel.a === sel.b, ag = ageOn(parse(sel.a.length === 7 ? sel.a + "-01" : sel.a));
  return (
    <div className="selbar">
      <div className="selin">
        <span className="selt"><b>{single ? fmtK(sel.a) : `${fmtK(sel.a)} → ${fmtK(sel.b)}`}</b>{ag >= 0 && <small> · age {ag}</small>}</span>
        {["goal", "task", "schedule"].map((k) => <button key={k} className="btn" onClick={() => { openRange(sel.a, sel.b, k); onClose(); }}><Ic n="plus" s={14} />{KIND[k][0]}</button>)}
        <button className="btn" onClick={() => { openRange(sel.a, sel.b, "challenge"); onClose(); }}><Ic n="plus" s={14} />Challenge</button>
        {single && <button className="btn" onClick={onOpen}>{openLabel}</button>}
        <button className="ib sm" onClick={onClose} aria-label="Clear selection"><Ic n="x" s={16} /></button>
      </div>
    </div>
  );
}
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function parseQuick(text) {
  let t = " " + text.trim() + " ", d = new Date(today), hit = false, timed = false, start = "09:00";
  if (/\btomorrow\b/i.test(t)) { d = addDays(d, 1); hit = true; t = t.replace(/\btomorrow\b/i, " "); }
  else if (/\btoday\b/i.test(t)) { hit = true; t = t.replace(/\btoday\b/i, " "); }
  else { const w = WD.findIndex((x) => new RegExp("\\b" + x + "\\b", "i").test(t)); if (w >= 0) { d = addDays(d, (w - d.getDay() + 7) % 7 || 7); hit = true; t = t.replace(new RegExp("\\b" + WD[w] + "\\b", "i"), " "); } }
  let m = t.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || t.match(/\bat\s*(\d{1,2})(?::(\d{2}))?\b/i);
  if (m) { let h = +m[1] % 24; if (m[3]) { h = (+m[1] % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0); } start = `${pad(h)}:${m[2] || "00"}`; timed = true; hit = true; t = t.replace(m[0], " "); }
  const title = t.replace(/\s+/g, " ").trim();
  if (!hit || !title) return null;
  const e = mins(start) + 60, end = `${pad(Math.min(23, Math.floor(e / 60)))}:${pad(e % 60)}`;
  return { title, date: dk(d), start, end, allDay: !timed, cal: "my", desc: "" };
}
const QUOTES = [
  ["Stay hungry, stay foolish.", "Steve Jobs"],
  ["Your time is limited, so don’t waste it living someone else’s life.", "Steve Jobs"],
  ["The best way to predict the future is to invent it.", "Alan Kay"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["A journey of a thousand miles begins with a single step.", "Lao Tzu"],
  ["Energy and persistence conquer all things.", "Benjamin Franklin"],
  ["Act as if what you do makes a difference. It does.", "William James"],
  ["Fall seven times, stand up eight.", "Japanese proverb"],
  ["Start where you are. Use what you have. Do what you can.", "Arthur Ashe"],
  ["We are what we repeatedly do. Excellence is a habit.", "Will Durant"],
  ["It always seems impossible until it’s done.", "Nelson Mandela"],
  ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
];
const VERSES = [
  ["I can do all things through Christ which strengtheneth me.", "Philippians 4:13"],
  ["Trust in the LORD with all thine heart; and lean not unto thine own understanding.", "Proverbs 3:5"],
  ["Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.", "Joshua 1:9"],
  ["Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee.", "Isaiah 41:10"],
  ["Commit thy works unto the LORD, and thy thoughts shall be established.", "Proverbs 16:3"],
  ["And let us not be weary in well doing: for in due season we shall reap, if we faint not.", "Galatians 6:9"],
  ["They that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles.", "Isaiah 40:31"],
  ["For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.", "2 Timothy 1:7"],
  ["This is the day which the LORD hath made; we will rejoice and be glad in it.", "Psalm 118:24"],
  ["God is our refuge and strength, a very present help in trouble.", "Psalm 46:1"],
  ["Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself.", "Matthew 6:34"],
  ["For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.", "Jeremiah 29:11"],
];
const ty = today.getFullYear();
/* ---------- App ---------- */
export default function GoogleCalendarClone() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      setAuthError("");
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) {
        setSession(data.session);
        setAuthLoading(false);
      }
    }).catch((error) => {
      if (active) {
        setAuthError(error instanceof Error ? error.message : "Could not check your sign-in status.");
        setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
  };

  if (authLoading) return <CloudStatus message="Connecting to Supabase…" />;
  if (!session) return <AuthScreen connectionError={authError} />;
  return <CalendarApp user={session.user} onSignOut={signOut} authError={authError} />;
}

function CloudStatus({ message, error, onRetry, onSignOut }) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <h1>{message}</h1>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {onRetry && <button className="auth-submit" onClick={onRetry}>Retry</button>}
        {onSignOut && <button className="auth-switch" onClick={onSignOut}>Sign out</button>}
      </section>
    </main>
  );
}

function CloudAccount({ email, syncStatus, onSignOut }) {
  const statusText = syncStatus === "saving" ? "Saving…" : syncStatus === "error" ? "Sync error" : "Synced";
  return (
    <div className="cloud-account">
      <span className={"cloud-sync " + (syncStatus === "error" ? "failed" : "")} role="status">{statusText}</span>
      <span className="cloud-email" title={email}>{email}</span>
      <button className="btn cloud-signout" onClick={onSignOut}>Sign out</button>
    </div>
  );
}

function CalendarApp({ user, onSignOut, authError }) {
  const [view, setView] = useState("month");
  const [cur, setCur] = useState(today);
  const [events, setEvents] = useState(() => load("events", []));
  const [calendars, setCalendars] = useState(() => normalizeCalendars(load("calendars", [])));
  const [goals, setGoals] = useState(() => load("goals", []));
  const [items, setItems] = useState(() => load("items", []));
  const [challenges, setChallenges] = useState(() => load("challenges", []));
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [syncStatus, setSyncStatus] = useState("saved");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [syncRetry, setSyncRetry] = useState(0);
  const [hidden, setHidden] = useState({});
  const [modal, setModal] = useState(null); // {type:'event'|'goal', data}
  const [side, setSide] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panel, setPanel] = useState(true);
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(() => load("dark", !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)));
  const [accent, setAccent] = useState(() => load("accent", null));
  const [range, setRange] = useState([ty - 3, ty + 8]);
  const [pal, setPal] = useState(false);
  const [help, setHelp] = useState(false);
  const [focus, setFocus] = useState(false);
  const [daily, setDaily] = useState(() => load("daily", true));
  const [toast, setToast] = useState(null);
  const [focusCh, setFocusCh] = useState(null);
  const [page, setPage] = useState("cal"); // "cal" | "goals"
  const touchStart = useRef(null);
  const swiping = useRef(false);
  const [monthDirection, setMonthDirection] = useState(1);
  const fc = focusCh ? challenges.find((c) => c.id === focusCh) : null;
  const special = !!fc || page === "goals";
  const showView = (v) => { setFocusCh(null); setPage("cal"); setView(v); };
  useEffect(() => { if (focusCh && !fc) setFocusCh(null); });
  useEffect(() => { try { localStorage.setItem("gc-daily", JSON.stringify(daily)); } catch {} }, [daily]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  const remove = (kind, id) => {
    const [list, setL] = kind === "event" ? [events, setEvents] : kind === "goal" ? [goals, setGoals] : kind === "challenge" ? [challenges, setChallenges] : [items, setItems];
    const obj = list.find((x) => x.id === id);
    setL(list.filter((x) => x.id !== id));
    setToast({ msg: `Deleted “${obj?.title || "item"}”`, undo: () => setL((p) => [...p, obj]) });
  };
  const deleteGoal = (id) => remove("goal", id);
  useEffect(() => { try { localStorage.setItem("gc-dark", JSON.stringify(dark)); localStorage.setItem("gc-accent", JSON.stringify(accent)); } catch {} }, [dark, accent]);
  useEffect(() => {
    let active = true;

    const loadCalendar = async () => {
      const { data: row, error } = await supabase
        .from("calendar_data")
        .select("data")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;

      const stored = row?.data;
      const localCalendar = removeDemoRecords({
        events: load("events", []),
        goals: load("goals", []),
        items: load("items", []),
        challenges: load("challenges", []),
        calendars: normalizeCalendars(load("calendars", [])),
      });
      const calendar = removeDemoRecords({
        events: Array.isArray(stored?.events) ? stored.events : localCalendar.events,
        goals: Array.isArray(stored?.goals) ? stored.goals : localCalendar.goals,
        items: Array.isArray(stored?.items) ? stored.items : localCalendar.items,
        challenges: Array.isArray(stored?.challenges) ? stored.challenges : localCalendar.challenges,
        calendars: normalizeCalendars(stored?.calendars ?? localCalendar.calendars),
      });
      const demoRecordsRemoved = ["events", "goals", "items"].some((kind) =>
        (Array.isArray(stored?.[kind]) ? stored[kind].length : 0) > calendar[kind].length);

      if (!row || demoRecordsRemoved) {
        const { error: saveError } = await supabase
          .from("calendar_data")
          .upsert({ user_id: user.id, data: calendar });
        if (saveError) throw saveError;
      }

      if (!active) return;
      setEvents(calendar.events);
      setCalendars(calendar.calendars);
      setGoals(calendar.goals);
      setItems(calendar.items);
      setChallenges(calendar.challenges);
      setCloudReady(true);
    };

    loadCalendar().catch((error) => {
      if (active) setCloudError(error instanceof Error ? error.message : "Could not load calendar data.");
    });

    return () => { active = false; };
  }, [user.id, loadAttempt]);

  useEffect(() => {
    if (!cloudReady) return undefined;
    let active = true;
    const timer = setTimeout(async () => {
      setSyncStatus("saving");
      const { error } = await supabase
        .from("calendar_data")
        .upsert({
          user_id: user.id,
          data: { events, calendars, goals, items, challenges },
          updated_at: new Date().toISOString(),
        });
      if (!active) return;
      if (error) {
        setSyncStatus("error");
        setCloudError(error.message);
      } else {
        setSyncStatus("saved");
        setCloudError("");
      }
    }, 500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cloudReady, user.id, events, calendars, goals, items, challenges, syncRetry]);
  useEffect(() => {
    const h = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal((p) => !p); }
      else if (e.key === "?" && !typing) setHelp((v) => !v);
      else if (e.key === "Escape") { setModal(null); setPal(false); setHelp(false); setDrawerOpen(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const nav = (dir) => {
    if (view === "month") setMonthDirection(dir);
    if (view === "day") setCur(addDays(cur, dir));
    else if (view === "week") setCur(addDays(cur, 7 * dir));
    else if (view === "month") setCur(addMonths(cur, dir));
    else if (view === "year") setCur(new Date(cur.getFullYear() + dir, cur.getMonth(), 1));
    else if (view === "decade") setCur(new Date(cur.getFullYear() + 10 * dir, 0, 1));
    else if (view === "life") return;
    else if (view === "custom") { const n = range[1] - range[0] + 1; setRange([range[0] + n * dir, range[1] + n * dir]); setCur(new Date(range[0] + n * dir, 0, 1)); }
    else setCur(new Date(cur.getFullYear() + 20 * dir, 0, 1));
  };

  useEffect(() => {
    const h = (e) => {
      if (modal || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const v = VIEWS.find((x) => x[2].toLowerCase() === e.key.toLowerCase());
      if (v) showView(v[0]);
      if (e.key === "g" || e.key === "G") { setFocusCh(null); setPage((p) => (p === "goals" ? "cal" : "goals")); }
      if (e.key === "Escape" && fc && !pal && !help) setFocusCh(null);
      if (e.key === "t" || e.key === "T") setCur(new Date());
      if (e.key === "f" || e.key === "F") setFocus((x) => !x);
      if (e.key === "ArrowLeft" && !special) nav(-1);
      if (e.key === "ArrowRight" && !special) nav(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const title = (() => {
    const y = cur.getFullYear();
    if (fc) return fc.title;
    if (page === "goals") return "Goals";
    if (view === "day") return `${MONTHS[cur.getMonth()]} ${cur.getDate()}, ${y}`;
    if (view === "custom") return `${range[0]} – ${range[1]}`;
    if (view === "life") return "Life in weeks";
    if (view === "year") return String(y);
    if (view === "decade") return `${decadeOf(y)} – ${decadeOf(y) + 9}`;
    if (view === "twenty") return `${decadeOf(y)} – ${decadeOf(y) + 19}`;
    return `${MONTHS[cur.getMonth()]} ${y}`;
  })();

  const calendarColor = (id) => calendars.find((calendar) => calendar.id === id)?.color || "#6366f1";
  const visible = events.filter((e) => !hidden[e.cal]);
  const eventsOn = (d) => visible.filter((e) => e.date === dk(d)).sort((a, b) => a.start.localeCompare(b.start));
  const newEvent = (d, start = "09:00", allDay = false, endAt) => {
    const h = Math.min(1439, endAt ? mins(endAt) : mins(start) + 60);
    setModal({ type: "event", data: { title: "", date: dk(d), start, end: `${pad(Math.min(23, Math.floor(h / 60)))}:${pad(h % 60)}`, allDay, cal: "my", desc: "" } });
  };
  const newGoal = (level, d) => setModal({ type: "goal", data: { title: "", level, date: dk(d), done: false } });
  const go = (v, d) => { setFocusCh(null); setPage("cal"); setView(v); setCur(d); };
  const openRange = (a, b, kind = "goal") => {
    const st = a.length === 7 ? a + "-01" : a, en = b.length === 7 ? lastDay(+b.slice(0, 4), +b.slice(5, 7) - 1) : b;
    if (kind === "challenge") { newChallenge(Math.max(1, Math.round((parse(en) - parse(st)) / 864e5) + 1), st); return; }
    setModal({ type: "range", data: { kind, title: "", start: st, end: en, done: false } });
  };
  const saveItem = (i) => setItems((p) => (i.id ? p.map((x) => (x.id === i.id ? i : x)) : [...p, { ...i, id: Date.now() }]));
  const toggleItem = (id) => setItems((p) => p.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  const newChallenge = (n = 21, start = dk(today)) => setModal({ type: "challenge", data: { title: "", start, days: n, note: "", checks: [] } });
  const openChallenge = (c) => { setFocusCh(c.id); setPage("cal"); };
  const editChallenge = (c) => setModal({ type: "challenge", data: c });
  const openGoals = () => { setFocusCh(null); setPage("goals"); };
  const saveChallenge = (c) => setChallenges((p) => (c.id ? p.map((x) => (x.id === c.id ? c : x)) : [...p, { ...c, id: Date.now() }]));
  const toggleCheck = (id, k) => {
    const c = challenges.find((x) => x.id === id); if (!c) return;
    const on = c.checks.includes(k), checks = on ? c.checks.filter((x) => x !== k) : [...c.checks, k];
    setChallenges((p) => p.map((x) => (x.id === id ? { ...x, checks } : x)));
    if (!on) {
      const s = cStats({ ...c, checks });
      if (s.complete) setToast({ msg: `\u201C${c.title}\u201D complete. Every day checked in.` });
      else if (k === dk(today) && [3, 7, 14, 21, 30, 50, 66, 75, 100, 200, 365].includes(s.streak)) setToast({ msg: `${s.streak}-day streak on \u201C${c.title}\u201D` });
    }
  };
  const setNote = (id, k, text) => setChallenges((p) => p.map((x) => (x.id === id ? { ...x, notes: { ...(x.notes || {}), [k]: text } } : x)));
  const chOn = (d) => challenges.filter((c) => cActive(c, dk(d)));
  const tlItems = [...items, ...challenges.map((c) => ({ id: "c" + c.id, ch: c, kind: "challenge", title: c.title, start: c.start, end: cEnd(c), done: cStats(c).complete }))];

  const saveEvent = (e) => setEvents((p) => (e.id ? p.map((x) => (x.id === e.id ? e : x)) : [...p, { ...e, id: Date.now() }]));
  const saveCalendar = (calendar) => setCalendars((previous) => normalizeCalendars([
    ...previous.filter((item) => item.id !== calendar.id),
    { ...calendar, id: calendar.id || `custom-${Date.now()}`, custom: true },
  ]));
  const deleteCalendar = (id) => {
    if (!window.confirm("Delete this calendar? Its events will be moved to My calendar.")) return;
    setEvents((previous) => previous.map((event) => event.cal === id ? { ...event, cal: "my" } : event));
    setCalendars((previous) => previous.filter((calendar) => calendar.id !== id));
    setModal(null);
  };
  const saveGoal = (g) => {
    const out = { id: g.id || Date.now(), title: g.title, level: g.level, key: goalKey(g.level, parse(g.date)), done: g.done };
    setGoals((p) => (g.id ? p.map((x) => (x.id === g.id ? out : x)) : [...p, out]));
  };
  const toggleGoal = (id) => setGoals((p) => p.map((g) => (g.id === id ? { ...g, done: !g.done } : g)));
  const goalsFor = (level, d) => goals.filter((g) => g.level === level && g.key === goalKey(level, d));
  const editGoal = (g) => {
    const date = g.level === "day" ? g.key : g.level === "month" ? g.key + "-01" : `${g.key}-01-01`;
    setModal({ type: "goal", data: { ...g, date } });
  };

  const dstart = decadeOf(cur.getFullYear());
  const yr = view === "custom" ? range : [dstart, dstart + (view === "twenty" ? 19 : 9)];
  const carry = () => setGoals((p) => p.map((g) => (g.level === "day" && !g.done && g.key < dk(today) ? { ...g, key: dk(today) } : g)));
  const ctx = { carry, range, setRange, cur, setCur, eventsOn, goalsFor, newEvent, newGoal, go, setModal, editGoal, toggleGoal, goals, items, openRange, toggleItem, events: visible, challenges, chOn, toggleCheck, openChallenge, newChallenge, fcId: focusCh, openGoals, calendarColor, monthDirection };

  const fileRef = useRef(null);
  const exportData = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ events, calendars, goals, items, challenges }, null, 2)], { type: "application/json" })); a.download = "calendar-backup.json"; a.click(); };
  const importFile = (e) => {
    const fl = e.target.files[0];
    if (fl) fl.text().then((t) => {
      try {
        const d = JSON.parse(t);
        if (d.events) setEvents(d.events);
        if (d.calendars) setCalendars(normalizeCalendars(d.calendars));
        if (d.goals) setGoals(d.goals);
        if (d.items) setItems(d.items);
        if (d.challenges) setChallenges(d.challenges);
      } catch {
        alert("That file isn’t a valid backup.");
      }
    });
    e.target.value = "";
  };
  const ym = special ? null : title.match(/^(.*?)(\s\d{4})$/);
  const titleEl = <h1 className="calendar-title">{ym && ["month", "day", "week"].includes(view) ? <>{ym[1]}<span>{ym[2]}</span></> : title}</h1>;
  const navExpanded = typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches ? drawerOpen : side;
  const chips = (
    <>
      {cur >= BIRTH && !["decade", "twenty", "custom", "life"].includes(view) && <span className="agechip">Age {ageOn(cur)}</span>}
      {["day", "week"].includes(view) && <span className="agechip">Day {Math.floor((cur - new Date(cur.getFullYear(), 0, 0)) / 864e5)} · Week {Math.ceil(Math.floor((cur - new Date(cur.getFullYear(), 0, 0)) / 864e5) / 7)}</span>}
    </>
  );
  const mainViews = ["day", "week", "month", "year"];

  if (!cloudReady) {
    return (
      <CloudStatus
        message={cloudError ? "Could not load your calendar." : "Loading your calendar…"}
        error={cloudError}
        onRetry={() => {
          setCloudError("");
          setLoadAttempt((attempt) => attempt + 1);
        }}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <div className={"gc" + (dark ? " dark" : "") + (focus ? " focus" : "")} style={accent ? { "--ac": accent } : undefined}>
      <style>{CSS}</style>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={importFile} />
      {focus ? (
        <header className="top focus-top">
          {titleEl}
          {chips}
          <div className="sp" />
          <span className="fbadge"><i />Focus</span>
          <button className="btn" onClick={() => setFocus(false)}><Ic n="shrink" s={15} />Exit focus<kbd>F</kbd></button>
          <CloudAccount email={user.email} syncStatus={syncStatus} onSignOut={onSignOut} />
        </header>
      ) : (
        <header className="top">
          <button className="ib sidebar-toggle" onClick={() => {
            if (window.matchMedia("(max-width: 800px)").matches) {
              setSide(true);
              setDrawerOpen(true);
            } else {
              setSide(!side);
            }
          }} aria-label="Toggle navigation" aria-expanded={navExpanded} aria-controls="calendar-drawer"><Ic n="menu" /></button>
          <div className="logo"><span className="logo-d">{today.getDate()}</span></div>
          <Seg className="pg" value={page} onChange={(v) => { setFocusCh(null); setPage(v); }} options={[["cal", "Calendar"], ["goals", "Goals"]]} />
          {!special && (
            <>
              <button className="btn today-nav" onClick={() => setCur(new Date())}>Today</button>
              <div className="navp calendar-nav">
                <button className="ib" onClick={() => nav(-1)} aria-label="Previous"><Ic n="left" /></button>
                <button className="ib" onClick={() => nav(1)} aria-label="Next"><Ic n="right" /></button>
              </div>
            </>
          )}
          {fc && <button className="btn back-nav" onClick={() => setFocusCh(null)}><Ic n="left" s={15} />Back</button>}
          {titleEl}
          {!special && chips}
          <div className="sp" />
          <button className="spill mobile-search" onClick={() => setPal(true)} aria-label="Search or quick add"><Ic n="search" s={16} /><span>Search or quick add</span><kbd>Ctrl K</kbd></button>
          {page !== "goals" && <button className={"ib panel-toggle" + (panel ? " live" : "")} onClick={() => setPanel(!panel)} aria-label="Toggle side panel" aria-pressed={panel} title="Side panel"><Ic n="panel" /></button>}
          {!special && <div className="rel view-picker">
            <button className="btn vb" onClick={() => setMenu(!menu)}>{VIEWS.find((v) => v[0] === view)[1]} <Ic n="down" s={16} /></button>
            {menu && (
              <>
                <div className="clickaway" onMouseDown={() => setMenu(false)} />
                <div className="menu">
                  {VIEWS.map(([k, n, sc]) => <button key={k} className={view === k ? "cur" : ""} onClick={() => { showView(k); setMenu(false); }}>{n}<kbd>{sc}</kbd></button>)}
                </div>
              </>
            )}
          </div>}
          <button className="ib focus-toggle" onClick={() => setFocus(true)} aria-label="Focus mode" title="Focus mode (F)"><Ic n="focus" /></button>
          {page !== "goals" && <button className={"ib quote-toggle" + (daily && panel ? " live" : "")} onClick={() => { if (!panel) { setPanel(true); setDaily(true); } else setDaily(!daily); }} aria-label="Daily quote" aria-pressed={daily && panel} title="Daily quote & verse"><Ic n="quote" /></button>}
          <button className="ib theme-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme" title="Dark / light"><Ic n={dark ? "sun" : "moon"} /></button>
          <CloudAccount email={user.email} syncStatus={syncStatus} onSignOut={onSignOut} />
        </header>
      )}

      {(cloudError || authError) && (
        <div className="cloud-alert" role="alert">
          <span>{cloudError || authError}</span>
          {cloudError && <button onClick={() => setSyncRetry((attempt) => attempt + 1)}>Retry sync</button>}
        </div>
      )}
      <div className="body">
        {drawerOpen && <button className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />}
        {(side || drawerOpen) && !focus && (
          <aside id="calendar-drawer" className={"side" + (drawerOpen ? " mobile-drawer" : "")} aria-label="Calendar navigation">
            <button className="create" onClick={() => { setDrawerOpen(false); newEvent(cur); }}><Ic n="plus" s={16} />Create</button>
            <div className="drawer-actions">
              <button className="btn" onClick={() => { setDrawerOpen(false); setPal(true); }}><Ic n="search" s={16} />Search</button>
              <button className="btn" onClick={() => setDark(!dark)}><Ic n={dark ? "sun" : "moon"} s={16} />{dark ? "Light theme" : "Dark theme"}</button>
            </div>
            <MiniMonth cur={cur} setCur={(d) => { setDrawerOpen(false); setFocusCh(null); setPage("cal"); setCur(d); if (view === "year" || view === "decade" || view === "twenty") setView("day"); }} eventsOn={eventsOn} />
            <TodayCard {...ctx} />
            <div className="cals">
              <div className="cal-head">
                <h3>My calendars</h3>
                <button className="ib sm" onClick={() => setModal({ type: "calendar", data: { name: "", color: "#8e5cf7" } })} aria-label="Add calendar" title="Add calendar"><Ic n="plus" s={15} /></button>
              </div>
              {calendars.map((c) => (
                <div key={c.id} className="cal-row">
                  <label>
                    <input type="checkbox" checked={!hidden[c.id]} onChange={() => setHidden({ ...hidden, [c.id]: !hidden[c.id] })} style={{ "--cc": c.color }} />
                    {c.name}
                  </label>
                  {c.custom && <button className="ib sm cal-edit" onClick={() => setModal({ type: "calendar", data: c })} aria-label={`Edit ${c.name}`} title={`Edit ${c.name}`}><Ic n="sliders" s={14} /></button>}
                </div>
              ))}
            </div>
          </aside>
        )}
        <main
          className="main"
          onTouchStart={(event) => {
            if (view === "month" && page === "cal") {
              const touch = event.touches[0];
              touchStart.current = { x: touch.clientX, y: touch.clientY };
            }
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            touchStart.current = null;
            if (!start) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) > 60 && Math.abs(dy) < 70) {
              swiping.current = true;
              nav(dx < 0 ? 1 : -1);
              window.setTimeout(() => { swiping.current = false; }, 500);
            }
          }}
          onClickCapture={(event) => {
            if (swiping.current) {
              event.preventDefault();
              event.stopPropagation();
              swiping.current = false;
            }
          }}
        >
          {fc ? <ChallengeView key={fc.id} c={fc} toggleCheck={toggleCheck} setNote={setNote} onEdit={() => editChallenge(fc)} onRestart={() => setModal({ type: "challenge", data: { title: fc.title, start: dk(today), days: fc.days, note: fc.note, checks: [] } })} />
            : page === "goals" ? <GoalsPage goals={goals} items={items} challenges={challenges} toggleGoal={toggleGoal} deleteGoal={deleteGoal} editGoal={editGoal} toggleItem={toggleItem} setModal={setModal} openChallenge={openChallenge} newGoal={newGoal} newChallenge={newChallenge} openRange={openRange} go={go} toggleCheck={toggleCheck} />
            : <>
          {(view === "day" || view === "week") && <TimeGrid {...ctx} days={view === "day" ? [cur] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cur), i))} />}
          {view === "month" && <MonthView key={`${cur.getFullYear()}-${cur.getMonth()}`} {...ctx} />}
          {view === "year" && <YearView {...ctx} items={tlItems} />}
          {["decade", "twenty", "custom"].includes(view) && <YearsView {...ctx} items={tlItems} view={view} from={yr[0]} to={yr[1]} />}
          {view === "life" && <LifeView />}
          </>}
        </main>
        {panel && !focus && page !== "goals" && <GoalsPanel {...ctx} daily={daily} />}
      </div>

      {!focus && !fc && page === "cal" && view === "month" && (
        <button className="mobile-fab" onClick={() => newEvent(cur)} aria-label="Create event" title="Create event">
          <Ic n="plus" s={24} />
        </button>
      )}
      {focus && (
        <div className="dock" role="toolbar" aria-label="Focus controls">
          <button className="ib" onClick={() => nav(-1)} aria-label="Previous"><Ic n="left" /></button>
          <button className="btn" onClick={() => setCur(new Date())}>Today</button>
          <button className="ib" onClick={() => nav(1)} aria-label="Next"><Ic n="right" /></button>
          <span className="dsep" />
          {mainViews.includes(view)
            ? <Seg value={view} onChange={showView} options={VIEWS.filter((v) => mainViews.includes(v[0])).map(([k, n]) => [k, n])} />
            : <span className="agechip">{VIEWS.find((v) => v[0] === view)[1]}</span>}
        </div>
      )}
      {modal?.type === "event" && <EventModal data={modal.data} calendars={calendars} calendarColor={calendarColor} close={() => setModal(null)} save={saveEvent} del={(id) => remove("event", id)} />}
      {modal?.type === "calendar" && <CalendarModal data={modal.data} close={() => setModal(null)} save={saveCalendar} del={deleteCalendar} />}
      {toast && <div className="toast"><span>{toast.msg}</span>{toast.undo && <button onClick={() => { toast.undo(); setToast(null); }}>Undo</button>}</div>}
      {pal && <Palette close={() => setPal(false)} go={go} setView={showView} setCur={(d) => { setFocusCh(null); setPage("cal"); setCur(d); }} openGoals={openGoals} openChallenge={openChallenge} events={events} goals={goals} items={items} challenges={challenges} newChallenge={() => newChallenge()} setAccent={setAccent} exportData={exportData} importClick={() => fileRef.current?.click()} toggleDark={() => setDark(!dark)} addEvent={(ev) => setEvents((p) => [...p, { ...ev, id: Date.now() }])} />}
      {help && (
        <Modal title="Keyboard shortcuts" close={() => setHelp(false)}>
          {[["D W M Y", "Day, Week, Month, Year"], ["X T C L", "Decade, 20 years, Custom, Life"], ["T", "Jump to today"], ["← →", "Previous / next"], ["Ctrl K", "Search & commands"], ["F", "Focus mode"], ["G", "Goals page"], ["Esc", "Close, or leave a challenge"], ["?", "This help"]].map(([k, n]) => <div key={k} className="pi"><span>{n}</span><small>{k}</small></div>)}
        </Modal>
      )}
      {modal?.type === "range" && <RangeModal data={modal.data} close={() => setModal(null)} save={saveItem} del={(id) => remove("item", id)} />}
      {modal?.type === "challenge" && <ChallengeModal data={modal.data} close={() => setModal(null)} save={saveChallenge} del={(id) => remove("challenge", id)} />}
      {modal?.type === "goal" && <GoalModal data={modal.data} close={() => setModal(null)} save={saveGoal} del={(id) => remove("goal", id)} />}
    </div>
  );
}

/* ---------- mini month ---------- */
function MiniMonth({ cur, setCur }) {
  const [m, setM] = useState(new Date(cur.getFullYear(), cur.getMonth(), 1));
  useEffect(() => setM(new Date(cur.getFullYear(), cur.getMonth(), 1)), [cur]);
  return (
    <div className="mini">
      <div className="mh">
        <b>{MONTHS[m.getMonth()]} {m.getFullYear()}</b>
        <button className="ib sm" onClick={() => setM(addMonths(m, -1))} aria-label="Previous month"><Ic n="left" s={15} /></button>
        <button className="ib sm" onClick={() => setM(addMonths(m, 1))} aria-label="Next month"><Ic n="right" s={15} /></button>
      </div>
      <div className="mg">
        {DAYS.map((d) => <span key={d} className="dow">{d[0]}</span>)}
        {monthGrid(m.getFullYear(), m.getMonth()).map((d) => (
          <button key={dk(d)} className={"md" + (same(d, today) ? " today" : same(d, cur) ? " sel" : "") + (d.getMonth() !== m.getMonth() ? " dim" : "")} onClick={() => setCur(d)}>{d.getDate()}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------- chips ---------- */
const Chip = ({ e, setModal, calendarColor }) => (
  <div className={"chip" + (e.allDay ? " ad" : "")} style={{ "--c": calendarColor(e.cal) }} onClick={(ev) => { ev.stopPropagation(); setModal({ type: "event", data: e }); }}>
    {!e.allDay && <i />}
    {!e.allDay && <small>{fmtTime(e.start)}</small>}
    <span>{e.title}</span>
  </div>
);
const RangeChip = ({ item, setModal, starts, ends }) => (
  <div
    className={"chip ad range-chip" + (item.done ? " done" : "") + (starts ? " starts" : "") + (ends ? " ends" : "")}
    style={{ "--c": KIND[item.kind]?.[1] || "#6366f1" }}
    title={`${item.title} · ${fmtK(item.start)} – ${fmtK(item.end)}`}
    onClick={(event) => { event.stopPropagation(); setModal({ type: "range", data: item }); }}
  >
    <span>{item.title}</span>
  </div>
);
const GoalChip = ({ g, editGoal, toggleGoal }) => (
  <div className={"gchip" + (g.done ? " done" : "")} title={g.title} onClick={(ev) => { ev.stopPropagation(); editGoal(g); }}>
    <span className="gk" onClick={(ev) => { ev.stopPropagation(); toggleGoal(g.id); }} />
    <span>{g.title}</span>
  </div>
);

const ChallengeChip = ({ c, k, can, toggleCheck, openChallenge }) => {
  const on = c.checks.includes(k);
  return (
    <div className={"gchip ch" + (on ? " done" : "")} title={c.title} onClick={(ev) => { ev.stopPropagation(); openChallenge(c); }}>
      <span className="gk" onClick={(ev) => { ev.stopPropagation(); if (can) toggleCheck(c.id, k); }} />
      <span>{c.title} · Day {cDay(c, k)}/{c.days}</span>
    </div>
  );
};

/* ---------- month ---------- */
function MonthView(p) {
  const grid = monthGrid(p.cur.getFullYear(), p.cur.getMonth());
  const rangeItems = p.items || [];
  const dragged = useRef(false);
  const selection = useDrag((a, b) => {
    if (a !== b) {
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
      p.openRange(a, b, "task");
    }
  });
  return (
    <div className="month" style={{ "--month-offset": p.monthDirection < 0 ? "-12px" : "12px" }}>
      <div className="mrow head">{DAYS.map((d) => <div key={d}>{d}</div>)}</div>
      <div className="mcells">
        {Array.from({ length: 6 }, (_, weekIndex) => {
          const week = grid.slice(weekIndex * 7, weekIndex * 7 + 7);
          const weekStart = dk(week[0]), weekEnd = dk(week[6]);
          const laneEnds = [];
          const segments = rangeItems
            .filter((item) => overlaps(item, weekStart, weekEnd))
            .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || String(a.id).localeCompare(String(b.id)))
            .map((item) => {
              const start = item.start < weekStart ? weekStart : item.start;
              const end = item.end > weekEnd ? weekEnd : item.end;
              const startColumn = week.findIndex((date) => dk(date) === start);
              const endColumn = week.findIndex((date) => dk(date) === end);
              let lane = laneEnds.findIndex((lastEnd) => lastEnd < startColumn);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = endColumn;
              return { item, startColumn, endColumn, lane };
            });
          const laneCount = laneEnds.length;

          return (
            <div
              key={weekIndex}
              className="month-week"
              style={{
                "--range-lanes": laneCount,
                gridTemplateRows: `24px ${"20px ".repeat(laneCount)}minmax(0, 1fr)`,
              }}
            >
              {week.map((d, column) => {
                const k = dk(d), ev = p.eventsOn(d), gl = p.goalsFor("day", d), cs = p.chOn(d);
                const items = [...gl.map((g) => ({ g })), ...ev.map((e) => ({ e }))];
                return (
                  <div
                    key={k}
                    className={"cell" + (column === 6 ? " last-col" : "") + (weekIndex === 5 ? " last-week" : "") + (d.getMonth() !== p.cur.getMonth() ? " dim" : "") + (d.getDay() % 6 === 0 ? " we" : "") + (selection.inSel(k) ? " pick" : "")}
                    style={{ gridColumn: column + 1, gridRow: "1 / -1" }}
                    onPointerDown={(event) => {
                      if (event.pointerType !== "touch" && event.button === 0 && !event.target.closest(".chip,.gchip,.num,.cdots")) selection.down(k);
                    }}
                    onPointerEnter={() => selection.over(k)}
                    onClickCapture={(event) => {
                      if (dragged.current) {
                        event.preventDefault();
                        event.stopPropagation();
                        dragged.current = false;
                      }
                    }}
                    onClick={() => p.newEvent(d, "09:00", true)}
                  >
                    <span className={"num" + (same(d, today) ? " today" : "")} onClick={(event) => { event.stopPropagation(); p.go("day", d); }}>{d.getDate() === 1 ? `${MONTHS[d.getMonth()].slice(0, 3)} 1` : d.getDate()}</span>
                    <div className="month-range-space" />
                    <div className="month-cell-items">
                      {cs.length > 0 && (
                        <div className="cdots">
                          {cs.slice(0, 4).map((c) => { const on = c.checks.includes(k); return <button key={c.id} className={"cdot" + (on ? " on" : k < dk(today) ? " miss" : "")} title={`${c.title} · day ${cDay(c, k)}/${c.days}${on ? " ✓" : ""} · double-click to open`} aria-label={`${c.title}: ${on ? "done" : "not done"}`} onClick={(event) => { event.stopPropagation(); if (k <= dk(today)) p.toggleCheck(c.id, k); }} onDoubleClick={(event) => { event.stopPropagation(); p.openChallenge(c); }} />; })}
                        </div>
                      )}
                      {d.getMonth() === 6 && d.getDate() === 17 && d.getFullYear() >= 2006 && <div className="bday">🎂 {d.getFullYear() === 2006 ? "Born" : `Turns ${d.getFullYear() - 2006}`}</div>}
                      {items.slice(0, 3).map((item) => item.g
                        ? <GoalChip key={"g" + item.g.id} g={item.g} {...p} />
                        : <Chip key={item.e.id} e={item.e} {...p} />)}
                      {items.length > 3 && <div className="more" onClick={(event) => { event.stopPropagation(); p.go("day", d); }}>{items.length - 3} more</div>}
                    </div>
                  </div>
                );
              })}
              {segments.map(({ item, startColumn, endColumn, lane }) => (
                <div key={`${item.id}-${weekIndex}`} style={{ gridColumn: `${startColumn + 1} / ${endColumn + 2}`, gridRow: lane + 2 }}>
                  <RangeChip item={item} setModal={p.setModal} starts={item.start >= weekStart} ends={item.end <= weekEnd} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- day / week ---------- */
function TimeGrid({ days, eventsOn, goalsFor, chOn, toggleCheck, openChallenge, newEvent, newGoal, setModal, editGoal, toggleGoal, go, calendarColor }) {
  const [now, setNow] = useState(new Date());
  const sc = useRef(null);
  const [sbw, setSbw] = useState(0), [pop, setPop] = useState(null);
  const [dr, setDr] = useState(null), drRef = useRef(null);
  drRef.current = dr;
  useEffect(() => {
    const up = () => { const q = drRef.current; if (!q) return; setDr(null); const lo = Math.min(q.a, q.b), hi = Math.min(1439, Math.max(q.a, q.b) + 30); const t = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; newEvent(q.d, t(lo), false, t(hi)); };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });
  const snap = (e) => Math.max(0, Math.min(1410, Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / 24) * 30));
  useEffect(() => { if (sc.current) sc.current.scrollTop = Math.max(0, (new Date().getHours() - 2) * 48); }, []);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, 1fr)` };
  // the hour grid scrolls and has a scrollbar; give the fixed header rows the same gutter so every column line matches
  const hcols = { ...cols, paddingRight: sbw };
  useEffect(() => {
    const el = sc.current; if (!el) return;
    const f = () => setSbw(el.offsetWidth - el.clientWidth);
    f(); const ro = new ResizeObserver(f); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tk = dk(today);
  const hasG = days.some((d) => goalsFor("day", d).length || chOn(d).length);
  return (
    <div className="tg">
      <div className="tg-head" style={hcols}>
        <div />
        {days.map((d) => (
          <div key={dk(d)} className="dh" onClick={() => go("day", d)}>
            <small className={same(d, today) ? "blue" : ""}>{DAYS[d.getDay()]}</small>
            <span className={"num big" + (same(d, today) ? " today" : "")}>{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="allday" style={hcols}>
        <div className="tz">All day</div>
        {days.map((d) => (
          <div key={dk(d)} onClick={() => newEvent(d, "09:00", true)}>
            {eventsOn(d).filter((e) => e.allDay).map((e) => <Chip key={e.id} e={e} setModal={setModal} calendarColor={calendarColor} />)}
          </div>
        ))}
      </div>
      {hasG && (
        <div className="goalrow" style={hcols}>
          <div className="tz">Goals</div>
          {days.map((d, i) => {
            const k = dk(d), gl = goalsFor("day", d), cs = chOn(d), can = k <= tk;
            const total = gl.length + cs.length, done = gl.filter((g) => g.done).length + cs.filter((c) => c.checks.includes(k)).length;
            return (
              <div key={k}>
                {days.length === 1 ? (
                  <>
                    {gl.map((g) => <GoalChip key={g.id} g={g} editGoal={editGoal} toggleGoal={toggleGoal} />)}
                    {cs.map((c) => <ChallengeChip key={c.id} c={c} k={k} can={can} toggleCheck={toggleCheck} openChallenge={openChallenge} />)}
                  </>
                ) : total > 0 && (
                  <>
                    <button className={"gsum" + (done === total ? " all" : "")} onClick={() => setPop(pop === k ? null : k)} aria-expanded={pop === k} title={`${done} of ${total} done`}>
                      <Ic n="target" s={12} />{done}/{total}<span className="gbar"><i style={{ width: (done / total) * 100 + "%" }} /></span>
                    </button>
                    {pop === k && (
                      <>
                        <div className="clickaway" onMouseDown={() => setPop(null)} />
                        <div className={"gpop" + (i >= days.length - 2 ? " r" : "")}>
                          <h5>{d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h5>
                          {gl.map((g) => (
                            <div key={g.id} className={"gr" + (g.done ? " done" : "")}>
                              <input type="checkbox" checked={g.done} onChange={() => toggleGoal(g.id)} />
                              <span onClick={() => { setPop(null); editGoal(g); }}>{g.title}</span>
                            </div>
                          ))}
                          {cs.map((c) => (
                            <div key={"c" + c.id} className={"gr" + (c.checks.includes(k) ? " done" : "")}>
                              <input type="checkbox" style={{ "--cc": "#ec4899" }} checked={c.checks.includes(k)} disabled={!can} onChange={() => toggleCheck(c.id, k)} />
                              <span onClick={() => { setPop(null); openChallenge(c); }}>{c.title}</span>
                              <small className="chd">Day {cDay(c, k)}/{c.days}</small>
                            </div>
                          ))}
                          <button className="link" onClick={() => { setPop(null); newGoal("day", d); }}><Ic n="plus" s={13} />Add goal</button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="tg-scroll" ref={sc}>
        <div className="tg-body" style={cols}>
          <div className="hours">{Array.from({ length: 24 }, (_, h) => <div key={h}>{h ? fmtTime(`${h}:00`) : ""}</div>)}</div>
          {days.map((d) => (
            <div key={dk(d)} className={"col" + (d.getDay() % 6 === 0 ? " we" : "")} onMouseDown={(e) => { if (e.button === 0) { const m = snap(e); setDr({ d, k: dk(d), a: m, b: m }); } }} onMouseMove={(e) => dr && dr.k === dk(d) && setDr({ ...dr, b: snap(e) })}>
              {eventsOn(d).filter((e) => !e.allDay).map((e) => {
                const top = (mins(e.start) / 60) * 48, h = Math.max(20, ((mins(e.end) - mins(e.start)) / 60) * 48);
                return (
                  <div key={e.id} className="ev" onMouseDown={(ev) => ev.stopPropagation()} style={{ top, height: h - 2, "--c": calendarColor(e.cal) }} onClick={(ev) => { ev.stopPropagation(); setModal({ type: "event", data: e }); }}>
                    <b>{e.title}</b><br /><small>{fmtTime(e.start)} – {fmtTime(e.end)}</small>
                  </div>
                );
              })}
              {dr && dr.k === dk(d) && <div className="sel-box" style={{ top: (Math.min(dr.a, dr.b) / 60) * 48, height: ((Math.abs(dr.b - dr.a) + 30) / 60) * 48 }} />}
              {same(d, now) && <div className="now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * 48 }}><i /></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- year ---------- */
function YearView(p) {
  const y = p.cur.getFullYear();
  const [picked, setPicked] = useState(null);
  const drag = useDrag((a, b) => setPicked({ a, b }));
  const inPk = (k) => !!picked && k >= picked.a && k <= picked.b;
  const yi = p.items.filter((i) => overlaps(i, `${y}-01-01`, `${y}-12-31`));
  const done = yi.filter((i) => i.done).length;
  return (
    <div className="yv">
      <div className="yvh">
        <h2>{y}</h2><span className="agechip">{yearAge(y)}</span>
        <div className="prog"><i style={{ width: yi.length ? (done / yi.length) * 100 + "%" : 0 }} /></div>
        <small className="hint">{done}/{yi.length} plans done · {Math.round((y < ty ? 1 : y > ty ? 0 : (today - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1))) * 100)}% of {y} elapsed · click or drag days to plan · double-click to open</small>
      </div>
      <div className="yg">
        {MONTHS.map((_, m) => (
          <div key={m} className="ym">
            <h4 onClick={() => p.go("month", new Date(y, m, 1))}>{MONTHS[m]}{monthAge(y, m) >= 0 && <small className="blue"> · age {monthAge(y, m)}</small>}</h4>
            <div className="mg">
              {DAYS.map((d) => <span key={d} className="dow">{d[0]}</span>)}
              {monthGrid(y, m).map((d) => {
                const k = dk(d);
                if (d.getMonth() !== m) return <span key={k} />;
                const its = yi.filter((i) => overlaps(i, k, k));
                const bd = m === 6 && d.getDate() === 17 && y >= 2006;
                const has = its.length || p.eventsOn(d).length;
                return (
                  <button key={k} title={bd ? "Birthday" : undefined}
                    className={"md" + (same(d, today) ? " today" : "") + ((drag.inSel(k) || inPk(k)) ? " pick" : "") + (has ? " has" : "")}
                    style={its[0] && !same(d, today) ? { background: KIND[its[0].kind][1] + "40" } : undefined}
                    onPointerDown={() => drag.down(k)} onPointerEnter={() => drag.over(k)} onDoubleClick={() => p.go("day", d)}>
                    {bd ? "🎂" : d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {picked && <SelBar sel={picked} onClose={() => setPicked(null)} openRange={p.openRange} onOpen={() => p.go("day", parse(picked.a))} openLabel="Open day" />}
    </div>
  );
}

/* ---------- decade / 20-year / custom vertical timeline ---------- */
function YearsView({ cur, view, from, to, range, setRange, go, goals, events, items: allItems, openRange, setModal, newGoal, toggleItem, openChallenge }) {
  const [flt, setFlt] = useState("all");
  const items = allItems.filter((i) => flt === "all" || i.kind === flt);
  const overdue = allItems.filter(late).length;
  const target = Math.max(from, Math.min(to, cur.getFullYear()));
  const decs = [];
  for (let d = decadeOf(from); d <= to; d += 10) decs.push(d);
  const [picked, setPicked] = useState(null);
  const drag = useDrag((a, b) => setPicked({ a, b }));
  const inPk = (k) => !!picked && k >= picked.a && k <= picked.b;
  useEffect(() => { document.getElementById("y" + target)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [target, from, to]);
  const lived = Math.min(100, ((today - BIRTH) / (80 * 365.25 * 864e5)) * 100);
  let nb = new Date(ty, 6, 17); if (nb < today) nb = new Date(ty + 1, 6, 17);
  const days = Math.ceil((nb - today) / 864e5), weeks = Math.floor((today - BIRTH) / (7 * 864e5));
  const yopts = Array.from({ length: 150 }, (_, i) => 1980 + i);
  return (
    <div className="tl">
      <div className="tlbar">
        {view === "custom" && (
          <div className="rng">
            <select value={from} onChange={(e) => setRange([+e.target.value, Math.max(+e.target.value, to)])}>{yopts.map((y) => <option key={y}>{y}</option>)}</select>
            <span>to</span>
            <select value={to} onChange={(e) => setRange([Math.min(from, +e.target.value), +e.target.value])}>{yopts.map((y) => <option key={y}>{y}</option>)}</select>
            {[["My life", 2006, ty], ["Next 10", ty, ty + 9], ["Last 5", ty - 4, ty]].map(([n, a, b]) => <button key={n} className="link" onClick={() => setRange([a, b])}>{n}</button>)}
          </div>
        )}
        <Seg value={flt} onChange={setFlt} options={[["all", "All"], ["goal", "Goals"], ["task", "Tasks"], ["schedule", "Schedules"], ["challenge", "Challenges"]]} />
        <div className="sp" />
        {overdue > 0 && <span className="od">{overdue} overdue</span>}
        <button className="btn" onClick={() => { const el = document.getElementById("y" + ty); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); else go(view, new Date()); }}>Jump to today</button>
      </div>
      <div className="life">
        <span className="agechip">Age {ageOn(today)}</span>
        <div className="prog"><i style={{ width: lived + "%" }} /></div>
        <small>{lived.toFixed(1)}% of 80 years · {weeks.toLocaleString()} weeks lived · birthday in {days} days</small>
        <small className="hint">Click or drag months to plan · double-click to open</small>
      </div>
      {decs.map((ds) => (
        <section key={ds} className="dec">
          <div className="dhd">
            <h2>{ds}s</h2><span className="agechip">{decAge(ds)}</span>
            {goals.filter((g) => g.level === "decade" && g.key === String(ds)).map((g) => <span key={g.id} className={"pill" + (g.done ? " done" : "")}>◎ {g.title}</span>)}
            <button className="link" onClick={() => newGoal("decade", new Date(ds, 0, 1))}><Ic n="plus" s={13} />Decade goal</button>
          </div>
          {Array.from({ length: 10 }, (_, i) => ds + i).filter((y) => y >= from && y <= to).map((y) => {
            const yi = items.filter((i) => overlaps(i, `${y}-01-01`, `${y}-12-31`));
            const yg = goals.filter((g) => g.level === "year" && g.key === String(y) && (flt === "all" || flt === "goal"));
            const all = [...yi, ...yg], dn = all.filter((x) => x.done).length;
            return (
              <div key={y} id={"y" + y} className={"yr" + (y === ty ? " cy" : "") + (y < 2006 ? " pre" : "")}>
                <div className="rail"><b>{y}</b><small>{yearAge(y)}</small></div>
                <div>
                  <div className="yt">
                    {all.length > 0 && <><div className="prog sm"><i style={{ width: (dn / all.length) * 100 + "%" }} /></div><small className="hint">{dn}/{all.length}</small></>}
                    {yg.map((g) => <span key={g.id} className={"pill" + (g.done ? " done" : "")}>◎ {g.title}</span>)}
                    <button className="link" onClick={() => newGoal("year", new Date(y, 0, 1))}><Ic n="plus" s={13} />Goal</button>
                    {y === ty && <span className="tag">Today</span>}
                    {y >= 2006 && <span className={"tag bd" + (MILE.includes(y - 2006) ? " star" : "")}>{MILE.includes(y - 2006) ? "★" : "🎂"} {y === 2006 ? "Born" : `Turns ${y - 2006}`} · Jul 17{MILE.includes(y - 2006) && " · milestone"}</span>}
                  </div>
                  <div className="ms">
                    {Array.from({ length: 12 }, (_, m) => {
                      const k = `${y}-${pad(m + 1)}`, a = k + "-01", b = lastDay(y, m), ag = monthAge(y, m);
                      const n = events.filter((e) => e.date >= a && e.date <= b).length + items.filter((i) => overlaps(i, a, b)).length + goals.filter((g) => g.level === "month" && g.key === k).length;
                      return (
                        <button key={k} title={`${MONTHS[m]} ${y}${ag >= 0 ? ` · age ${ag}` : ""}`}
                          className={"mc h" + Math.min(4, n) + ((drag.inSel(k) || inPk(k)) ? " pick" : "") + (y === ty && m === today.getMonth() ? " nowm" : "")}
                          onPointerDown={() => drag.down(k)} onPointerEnter={() => drag.over(k)} onDoubleClick={() => go("month", new Date(y, m, 1))}>
                          <span>{MONTHS[m].slice(0, 3)}</span>
                          {ag >= 0 && <small>{m === 6 && y >= 2006 ? "🎂" : ""}{ag}</small>}
                          {n > 0 && <em>{n}</em>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="bars">
                    {yi.map((i) => {
                      const s0 = i.start.slice(0, 4) < String(y) ? 0 : +i.start.slice(5, 7) - 1;
                      const e0 = i.end.slice(0, 4) > String(y) ? 11 : +i.end.slice(5, 7) - 1;
                      return (
                        <div key={i.id} title={`${KIND[i.kind][0]}: ${i.title}\n${i.start} → ${i.end} · ${Math.round((parse(i.end) - parse(i.start)) / 864e5) + 1} days · age ${ageOn(parse(i.start))}${ageOn(parse(i.end)) !== ageOn(parse(i.start)) ? " → " + ageOn(parse(i.end)) : ""}${late(i) ? "\nOverdue" : ""}`}
                          className={"bar" + (i.done ? " done" : "")} style={{ gridColumn: `${s0 + 1} / ${e0 + 2}`, "--c": late(i) ? "var(--red)" : KIND[i.kind][1] }} onClick={() => (i.ch ? openChallenge(i.ch) : setModal({ type: "range", data: i }))}>
                          {!i.ch && <span className="gk" onClick={(e) => { e.stopPropagation(); toggleItem(i.id); }} />}<span className="bt">{i.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      {picked && <SelBar sel={picked} onClose={() => setPicked(null)} openRange={openRange} onOpen={() => go("month", parse(picked.a + "-01"))} openLabel="Open month" />}
    </div>
  );
}

function RangeModal({ data, close, save, del }) {
  const [f, setF] = useState(data);
  const set = (k, v) => setF({ ...f, [k]: v });
  const days = Math.round((parse(f.end) - parse(f.start)) / 864e5) + 1;
  const a = ageOn(parse(f.start)), b = ageOn(parse(f.end));
  return (
    <Modal title={f.id ? "Edit plan" : "New plan"} close={close}>
      <input className="ti" autoFocus placeholder="What's the plan?" value={f.title} onChange={(e) => set("title", e.target.value)} />
      <Seg value={f.kind} onChange={(v) => set("kind", v)} options={Object.entries(KIND).filter(([k]) => k !== "challenge").map(([k, [n]]) => [k, n])} />
      <div className="fr"><input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} /> – <input type="date" value={f.end} onChange={(e) => set("end", e.target.value)} /></div>
      <small className="hint">{days > 0 ? `${days} days` : "End is before start"}{a >= 0 ? ` · age ${a}${b !== a ? " → " + b : ""}` : ""}</small>
      <label className="ck" style={{ marginTop: 10 }}><input type="checkbox" checked={f.done} onChange={(e) => set("done", e.target.checked)} /> Completed</label>
      <div className="act">
        {f.id && <button className="btn red" onClick={() => { del(f.id); close(); }}>Delete</button>}
        <div className="sp" />
        <button className="btn fill" onClick={() => { const sw = f.start > f.end; save({ ...f, start: sw ? f.end : f.start, end: sw ? f.start : f.end, title: f.title.trim() || KIND[f.kind][0] }); close(); }}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------- sidebar today card ---------- */
function TodayCard({ goalsFor, items, events, chOn }) {
  const gl0 = goalsFor("day", today), cs0 = chOn(today), tk0 = dk(today);
  const dg = [...gl0, ...cs0], dd = gl0.filter((g) => g.done).length + cs0.filter((c) => c.checks.includes(tk0)).length;
  const t0 = dk(today);
  const up = [...events.filter((e) => e.date >= t0).map((e) => ({ t: e.title, d: e.date })), ...items.filter((i) => !i.done && i.end >= t0).map((i) => ({ t: i.title, d: i.start > t0 ? i.start : t0 }))].sort((a, b) => a.d.localeCompare(b.d))[0];
  const away = up ? Math.round((parse(up.d) - parse(t0)) / 864e5) : 0;
  return (
    <div className="card tc">
      <div className="pring">
        <svg viewBox="0 0 44 44"><circle className="bg" cx="22" cy="22" r="18" /><circle className="fg" cx="22" cy="22" r="18" strokeDasharray={`${(dg.length ? dd / dg.length : 0) * 113.1} 113.1`} /></svg>
        <div><b>Today’s focus</b><div className="hint">{dg.length ? `${dd} of ${dg.length} goals done` : "No goals for today"}</div></div>
      </div>
      <div className="hr" />
      <div className="hint">Next up</div>
      {up ? <div><b>{up.t}</b> <span className="hint">· {away === 0 ? "today" : away === 1 ? "tomorrow" : `in ${away} days`}</span></div> : <div className="hint">Nothing coming up</div>}
    </div>
  );
}

/* ---------- daily card (top of the right column) ---------- */
function Daily() {
  const [n, setN] = useState(0), [tab, setTab] = useState("quote");
  const doy = Math.floor((today - new Date(ty, 0, 0)) / 864e5);
  const c = tab === "quote" ? QUOTES[(doy + n) % QUOTES.length] : VERSES[(doy + n) % VERSES.length];
  return (
    <div className="dcard">
      <div className="dtop">
        <span>{today.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
        <button className="dref" onClick={() => setN(n + 1)} aria-label="Show another" title="Show another"><Ic n="refresh" s={15} /></button>
      </div>
      <Seg className="glass" value={tab} onChange={setTab} options={[["quote", "Quote"], ["verse", "Verse"]]} />
      <figure className="dq">
        <blockquote key={tab + n} className={"dtext" + (tab === "verse" ? " serif" : "")}>{tab === "quote" ? `\u201C${c[0]}\u201D` : c[0]}</blockquote>
        <figcaption className="dsrc">{tab === "quote" ? c[1] : c[1] + " \u00B7 KJV"}</figcaption>
      </figure>
    </div>
  );
}

/* ---------- command palette ---------- */
function Palette({ close, go, setView, setCur, openGoals, openChallenge, events, goals, items, challenges, newChallenge, setAccent, exportData, importClick, toggleDark, addEvent }) {
  const [q, setQ] = useState(""), [i, setI] = useState(0);
  const ql = q.trim().toLowerCase(), res = [];
  const qa = parseQuick(q);
  if (qa) res.push({ t: `Add “${qa.title}” · ${qa.date}${qa.allDay ? " · all day" : " · " + fmtTime(qa.start)}`, k: "Quick add", run: () => { addEvent(qa); go("day", parse(qa.date)); } });
  if (/^\d{4}$/.test(ql)) res.push({ t: `Go to ${ql}`, k: "Year", run: () => go("year", new Date(+ql, 0, 1)) });
  const hit = (s) => ql.split(/\s+/).every((t) => s.includes(t));
  if (!ql || "today".includes(ql)) res.push({ t: "Jump to today", k: "Go", run: () => setCur(new Date()) });
  if (!ql || hit("goals page all goals")) res.push({ t: "Open goals page", k: "Go", run: openGoals });
  if (!ql || hit("new challenge streak habit")) res.push({ t: "New challenge…", k: "Create", run: () => newChallenge() });
  VIEWS.forEach(([k, n], idx) => { if (ql ? n.toLowerCase().includes(ql) : idx < 4) res.push({ t: `${n} view`, k: "View", run: () => setView(k) }); });
  if (!ql || "dark light theme".includes(ql)) res.push({ t: "Toggle dark mode", k: "Theme", run: toggleDark });
  [["Indigo", null], ["Violet", "#8e5cf7"], ["Green", "#0b9d58"], ["Orange", "#f26b1d"], ["Rose", "#e5367a"]].forEach(([n, c]) => { if (ql && hit(`accent colour color theme ${n}`.toLowerCase())) res.push({ t: `Accent: ${n}`, k: "Theme", run: () => setAccent(c) }); });
  if (ql && hit("backup export data")) res.push({ t: "Export backup", k: "Data", run: exportData });
  if (ql && hit("backup import restore data")) res.push({ t: "Import backup…", k: "Data", run: importClick });
  if (ql.length > 1) {
    events.filter((e) => e.title.toLowerCase().includes(ql)).forEach((e) => res.push({ t: e.title, k: "Event · " + e.date, run: () => go("day", parse(e.date)) }));
    challenges.filter((c) => c.title.toLowerCase().includes(ql)).forEach((c) => res.push({ t: c.title, k: "Challenge · " + c.days + " days", run: () => openChallenge(c) }));
    items.filter((x) => x.title.toLowerCase().includes(ql)).forEach((x) => res.push({ t: x.title, k: KIND[x.kind][0] + " · " + x.start, run: () => go("month", parse(x.start)) }));
    goals.filter((g) => g.title.toLowerCase().includes(ql)).forEach((g) => res.push({ t: g.title, k: "Goal · " + g.level, run: () => go(g.level === "day" ? "day" : g.level === "month" ? "month" : "year", parse(g.level === "day" ? g.key : g.level === "month" ? g.key + "-01" : g.key + "-01-01")) }));
  }
  const list = res.slice(0, 8), pick = (r) => { r.run(); close(); };
  return (
    <div className="ov top-ov" onMouseDown={close}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="Search, jump to a year, or quick add: “Gym tomorrow 6pm”" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(i - 1, 0)); } if (e.key === "Enter" && list[i]) pick(list[i]); }} />
        {list.map((r, n) => <div key={n} className={"pi" + (n === i ? " on" : "")} onMouseEnter={() => setI(n)} onClick={() => pick(r)}><span>{r.t}</span><small>{r.k}</small></div>)}
        {!list.length && <div className="pi"><small>No results</small></div>}
      </div>
    </div>
  );
}

/* ---------- life in weeks / months (fits the screen) ---------- */
function LifeView() {
  const [unit, setUnit] = useState("weeks");
  const box = useRef(null);
  const [sz, setSz] = useState(8);
  const rows = unit === "weeks" ? 52 : 12, cols = 80, total = rows * cols;
  useEffect(() => {
    const el = box.current; if (!el) return;
    const f = () => setSz(Math.max(3, Math.floor(Math.min((el.clientWidth - (unit === "months" ? 30 : 6) - 2 * (cols - 1)) / cols, (el.clientHeight - 26 - 2 * (rows - 1)) / rows))));
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, [rows, unit]);
  const lived = unit === "weeks" ? Math.floor((today - BIRTH) / (7 * 864e5)) : (ty - 2006) * 12 + today.getMonth() - 6 - (today.getDate() < 17 ? 1 : 0);
  return (
    <div className="lw">
      <div className="lwh">
        <h2>Your life</h2>
        <Seg value={unit} onChange={setUnit} options={[["weeks", "Weeks"], ["months", "Months"]]} />
        <small>{lived.toLocaleString()} {unit} lived · {(total - lived).toLocaleString()} left of 80 years · {((lived / total) * 100).toFixed(1)}%</small>
      </div>
      <div className="lwbox" ref={box}>
        <div className="lwwrap">
          {unit === "months" && <div className="lwm" style={{ gridTemplateRows: `repeat(12,${sz}px)` }}>{Array.from({ length: 12 }, (_, r) => <small key={r}>{MONTHS[(6 + r) % 12][0]}</small>)}</div>}
          <div>
            <div className="lwa" style={{ gridTemplateColumns: `repeat(${cols},${sz}px)` }}>{Array.from({ length: cols }, (_, a) => <small key={a}>{a % 10 === 0 ? a : ""}</small>)}</div>
            <div className="lwg" style={{ gridTemplateRows: `repeat(${rows},${sz}px)`, gridTemplateColumns: `repeat(${cols},${sz}px)` }}>
              {Array.from({ length: total }, (_, k) => {
                const dt = unit === "weeks" ? new Date(BIRTH.getTime() + k * 7 * 864e5) : new Date(2006, 6 + k, 17);
                return <i key={k} className={k < lived ? "l" : k === lived ? "c" : ""} title={`${dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · age ${Math.floor(k / rows)}`} />;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- goals panel ---------- */
function GoalsPanel({ fcId, openGoals, cur, daily, goals, carry, goalsFor, newGoal, editGoal, toggleGoal, deleteGoal, items, openRange, toggleItem, setModal, challenges, toggleCheck, openChallenge, newChallenge }) {
  const od = goals.filter((g) => g.level === "day" && !g.done && g.key < dk(today)).length;
  const ms = dk(cur).slice(0, 7), mine = items.filter((i) => overlaps(i, ms + "-01", lastDay(cur.getFullYear(), cur.getMonth())));
  const secs = [
    ["day", `Today · ${MONTHS[cur.getMonth()].slice(0, 3)} ${cur.getDate()}`],
    ["month", `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`],
    ["year", `Year ${cur.getFullYear()}`],
    ["decade", `Decade ${decadeOf(cur.getFullYear())}s`],
  ];
  const ck = dk(cur), rank = (s) => (s.finished || s.complete ? 2 : s.upcoming ? 1 : 0);
  const chs = challenges.map((c) => ({ c, s: cStats(c) })).sort((a, b) => rank(a.s) - rank(b.s) || a.c.start.localeCompare(b.c.start));
  const Sec = ([lv, label]) => (
    <div key={lv} className="gs">
      <div className="gh"><b>{label}</b><button className="ib sm" onClick={() => newGoal(lv, cur)} aria-label="Add goal"><Ic n="plus" s={15} /></button></div>
      {goalsFor(lv, cur).map((g) => (
        <div key={g.id} className={"gr" + (g.done ? " done" : "")}>
          <input type="checkbox" checked={g.done} onChange={() => toggleGoal(g.id)} />
          <span onClick={() => editGoal(g)}>{g.title}</span>
          <button className="ib sm goal-delete" onClick={() => deleteGoal(g.id)} aria-label={`Delete goal: ${g.title}`} title="Delete goal"><Ic n="trash" s={14} /></button>
        </div>
      ))}
      {!goalsFor(lv, cur).length && <div className="empty">No {lv} goals</div>}
    </div>
  );
  return (
    <aside className="gp">
      {daily && <Daily />}
      <div className="gscroll">
        <div className="gph"><h3>Goals</h3><button className="link" onClick={openGoals}>View all</button></div>
        {od > 0 && <button className="carry" onClick={carry}><Ic n="refresh" s={14} />Carry {od} unfinished to today</button>}
        {Sec(secs[0])}
        <div className="gs">
          <div className="gh"><b>Challenges</b><button className="ib sm" onClick={() => newChallenge()} aria-label="New challenge"><Ic n="plus" s={15} /></button></div>
          {chs.map(({ c, s }) => {
            const can = cActive(c, ck) && ck <= dk(today);
            return (
              <div key={c.id} className={"chr" + (s.finished || s.complete ? " end" : "") + (fcId === c.id ? " cur" : "")}>
                <div className="chr1">
                  <input type="checkbox" style={{ "--cc": "#ec4899" }} checked={c.checks.includes(ck)} disabled={!can} onChange={() => toggleCheck(c.id, ck)} aria-label={`Check in: ${c.title}`} />
                  <span onClick={() => openChallenge(c)}>{c.title}</span>
                  <small>{s.complete ? "Complete" : s.upcoming ? "Upcoming" : s.finished ? "Ended" : `Day ${s.dayNo}/${c.days}`}</small>
                </div>
                <div className="chr2">
                  <div className="prog w pk"><i style={{ width: s.pct * 100 + "%" }} /></div>
                  <small>{s.streak > 0 ? `${s.streak}-day streak · ` : ""}{Math.round(s.pct * 100)}%</small>
                </div>
              </div>
            );
          })}
          {!challenges.length && (
            <>
              <div className="empty">Build a streak. Pick a length to start today:</div>
              <div className="presets">{[21, 30, 66, 75, 100].map((n) => <button key={n} className="btn sm" onClick={() => newChallenge(n)}>{n} days</button>)}</div>
            </>
          )}
        </div>
        {secs.slice(1).map(Sec)}
        <div className="gs">
          <div className="gh"><b>Plans this month</b><button className="ib sm" onClick={() => openRange(ms, ms)} aria-label="Add plan"><Ic n="plus" s={15} /></button></div>
          {mine.map((i) => (
            <div key={i.id} className={"gr" + (i.done ? " done" : "")}>
              <input type="checkbox" checked={i.done} onChange={() => toggleItem(i.id)} />
              <span onClick={() => setModal({ type: "range", data: i })}>{i.title}</span>
              <small style={{ color: KIND[i.kind][1] }}>{KIND[i.kind][0]}</small>
            </div>
          ))}
          {!mine.length && <div className="empty">Nothing planned</div>}
        </div>
      </div>
    </aside>
  );
}

/* ---------- isolated challenge view ---------- */
function ChallengeView({ c, toggleCheck, setNote, onEdit, onRestart }) {
  const s = cStats(c), t = dk(today), end = cEnd(c), set = new Set(c.checks);
  const start = parse(c.start), lead = start.getDay();
  const nowRef = useRef(null);
  const [jd, setJd] = useState(null);
  useEffect(() => { nowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [c.id]);
  const startsIn = Math.round((start - parse(t)) / 864e5);
  const left = s.upcoming ? c.days : s.finished ? 0 : c.days - s.dayNo;
  const status = s.complete ? "Complete" : s.finished ? "Ended" : s.upcoming ? `Starts in ${startsIn} ${startsIn === 1 ? "day" : "days"}` : `Day ${s.dayNo} of ${c.days}`;
  const pct = Math.round(s.pct * 100), R = 44, CIRC = 2 * Math.PI * R;
  const active = !s.upcoming && !s.finished, checked = set.has(t);
  const done = [...set].filter((k) => k >= c.start && k <= end).sort(), wd = Array(7).fill(0);
  let best = 0, run = 0, prev = null;
  done.forEach((k) => { run = prev && Math.round((parse(k) - parse(prev)) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = k; wd[parse(k).getDay()]++; });
  const strong = Math.max(...wd) > 0 ? DAYS[wd.indexOf(Math.max(...wd))] : "\u2013";
  const lines = s.complete ? "Every day is checked in. Well done." : s.finished ? `You checked in ${s.inRange} of ${c.days} days.` : s.upcoming ? `Your first day is ${fmtK(c.start)}.` : s.streak > 1 ? `${s.streak} days in a row. Keep it going.` : "One check-in a day. Tap any past day to fill it in.";
  return (
    <div className="cv">
      <section className="cvh">
        <div className="cvring" role="img" aria-label={`${pct}% complete`}>
          <svg viewBox="0 0 104 104"><circle className="bg" cx="52" cy="52" r={R} /><circle className="fg" cx="52" cy="52" r={R} strokeDasharray={`${s.pct * CIRC} ${CIRC}`} /></svg>
          <b>{pct}%</b>
        </div>
        <div className="cvt">
          <span className="cvk">{status}</span>
          <h2>{c.title}</h2>
          <p className="cvd">{fmtK(c.start)} to {fmtK(end)} · {c.days} days</p>
          {c.note && <p className="cvn">{c.note}</p>}
        </div>
        <div className="cva">
          {active && (
            <button className={"btn" + (checked ? "" : " fill")} onClick={() => toggleCheck(c.id, t)} title={checked ? "Undo today’s check-in" : undefined}>
              {checked ? <><Ic n="check" s={15} />Done today</> : <>Check in for day {s.dayNo}</>}
            </button>
          )}
          {(s.finished || s.complete) && <button className="btn fill" onClick={onRestart}>Run again</button>}
          <button className="btn" onClick={onEdit}>Edit</button>
        </div>
      </section>
      <div className="cvs">
        <div><b>{s.inRange}</b><small>checked in</small></div>
        <div><b>{s.streak}</b><small>day streak</small></div>
        <div><b>{s.missed}</b><small>missed</small></div>
        <div><b>{left}</b><small>{left === 1 ? "day left" : "days left"}</small></div>
        <div><b>{best}</b><small>best streak</small></div>
        <div><b>{strong}</b><small>strongest day</small></div>
      </div>
      <p className="cvl">{lines}</p>
      {jd && (
        <div className="cvj"><label htmlFor="cvn">Note for day {cDay(c, jd)} · {fmtK(jd)}</label><textarea id="cvn" placeholder="How did it go?" value={(c.notes || {})[jd] || ""} onChange={(e) => setNote(c.id, jd, e.target.value)} /></div>
      )}
      <div className="cvw">{DAYS.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cvg">
        {Array.from({ length: lead }, (_, i) => <span key={"p" + i} />)}
        {Array.from({ length: c.days }, (_, i) => {
          const k = dk(addDays(start, i)), d = parse(k), on = set.has(k), fut = k > t, now = k === t, miss = !on && k < t;
          const lab = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
          return (
            <button key={k} ref={now ? nowRef : null} disabled={fut} aria-pressed={on}
              aria-label={`Day ${i + 1}, ${lab}, ${on ? "checked in" : fut ? "upcoming" : "not checked in"}`}
              className={"ct" + (on ? " on" : "") + (miss ? " miss" : "") + (now ? " tdy" : "") + (fut ? " fut" : "") + ((c.notes || {})[k] ? " hasn" : "")}
              onClick={() => { toggleCheck(c.id, k); setJd(k); }}>
              <b>{i + 1}</b><small>{lab}</small>
            </button>
          );
        })}
      </div>
      <div className="cvkey"><span><i className="on" />Checked in</span><span><i className="miss" />Missed</span><span><i className="tdy" />Today</span></div>
    </div>
  );
}

function Heat({ challenges }) {
  const cnt = {}; challenges.forEach((c) => c.checks.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; }));
  const s0 = startOfWeek(addDays(today, -7 * 25)), tk = dk(today), a = dk(s0), mx = Math.max(1, ...Object.values(cnt));
  const total = Object.entries(cnt).filter(([k]) => k >= a && k <= tk).reduce((t, [, n]) => t + n, 0);
  return (
    <section className="gsec wide">
      <div className="gsech"><h3>Check-ins</h3><span className="cnt">{total}</span><small className="hint">last 26 weeks</small></div>
      <div className="heat" role="img" aria-label={`${total} check-ins in the last 26 weeks`}>
        {Array.from({ length: 182 }, (_, i) => { const k = dk(addDays(s0, i)), n = cnt[k] || 0; return <i key={k} title={`${fmtK(k)} · ${n} check-in${n === 1 ? "" : "s"}`} style={k > tk ? { visibility: "hidden" } : n ? { background: `color-mix(in srgb, #ec4899 ${Math.round(35 + 65 * n / mx)}%, var(--bg))` } : undefined} />; })}
      </div>
    </section>
  );
}

/* ---------- goals page: everything you are pursuing ---------- */
function GoalsPage({ goals, items, challenges, toggleGoal, deleteGoal, editGoal, toggleItem, setModal, openChallenge, newGoal, newChallenge, openRange, go, toggleCheck }) {
  const [st, setSt] = useState("active"), [q, setQ] = useState("");
  const ql = q.trim().toLowerCase(), has = (t) => !ql || t.toLowerCase().includes(ql);
  const tk = dk(today), mk = tk.slice(0, 7), yk = String(ty), dc = String(decadeOf(ty));
  const now = { day: tk, month: mk, year: yk, decade: dc };
  const keep = (done) => st === "all" || (st === "active" ? !done : done);
  const plans = items.filter((i) => i.kind === "goal");
  const chDone = (s) => s.complete || s.finished;
  const chs = challenges.map((c) => ({ c, s: cStats(c) }));
  const total = goals.length + plans.length + chs.length;
  const doneN = goals.filter((g) => g.done).length + plans.filter((i) => i.done).length + chs.filter(({ s }) => chDone(s)).length;
  const overdue = goals.filter((g) => !g.done && g.key < now[g.level]).length + plans.filter(late).length;
  const pct = total ? doneN / total : 0, R = 22, CIRC = 2 * Math.PI * R;
  const dueG = goals.filter((g) => g.level === "day" && g.key === tk), dueC = chs.filter(({ s }) => !s.upcoming && !s.finished);
  const dueDone = dueG.filter((g) => g.done).length + dueC.filter(({ c }) => c.checks.includes(tk)).length;

  const when = (g) => {
    const behind = g.key < now[g.level] && !g.done, here = g.key === now[g.level];
    let text;
    if (g.level === "day") {
      const n = Math.round((parse(tk) - parse(g.key)) / 864e5);
      text = here ? "Today" : n === -1 ? "Tomorrow" : n === 1 ? "Yesterday" : fmtK(g.key);
      if (behind) text = n === 1 ? "Yesterday · overdue" : `${fmtK(g.key)} · ${n} days overdue`;
    } else {
      text = g.level === "month" ? (here ? "This month" : fmtK(g.key)) : g.level === "year" ? (here ? "This year" : g.key) : (here ? "This decade" : g.key + "s");
      if (behind) text += " · overdue";
    }
    return [text, behind ? "late" : here ? "here" : ""];
  };
  const show = (g) => {
    if (g.level === "day") go("day", parse(g.key));
    else if (g.level === "month") go("month", parse(g.key + "-01"));
    else if (g.level === "year") go("year", new Date(+g.key, 0, 1));
    else go("decade", new Date(+g.key, 0, 1));
  };
  const rows = (level) => goals.filter((g) => g.level === level && keep(g.done) && has(g.title)).sort((a, b) => (a.done - b.done) || a.key.localeCompare(b.key));
  const SECS = [["day", "Daily goals"], ["month", "Monthly goals"], ["year", "Yearly goals"], ["decade", "Decade goals"]];
  const emptyTxt = st === "done" ? "Nothing completed yet" : st === "active" ? "Nothing in progress" : "Nothing here yet";
  const chRows = chs.filter(({ c, s }) => keep(chDone(s)) && has(c.title)).sort((a, b) => (chDone(a.s) - chDone(b.s)) || (a.s.upcoming - b.s.upcoming) || a.c.start.localeCompare(b.c.start));
  const planRows = plans.filter((i) => keep(i.done) && has(i.title)).sort((a, b) => (a.done - b.done) || a.start.localeCompare(b.start));

  if (!total) return (
    <div className="gpg">
      <div className="gpgh"><h2>Goals</h2></div>
      <div className="gzero">
        <h3>Nothing to pursue yet</h3>
        <p>Add a goal for today, this month, this year or this decade, or start a streak with a challenge.</p>
        <div className="gzb"><button className="btn fill" onClick={() => newGoal("day", today)}><Ic n="plus" s={15} />New goal</button><button className="btn" onClick={() => newChallenge()}>New challenge</button></div>
      </div>
    </div>
  );
  return (
    <div className="gpg">
      <div className="gpgh">
        <h2>Goals</h2>
        <div className="sp" />
        <input className="gsearch" type="search" placeholder="Search goals" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search goals" />
        <Seg value={st} onChange={setSt} options={[["active", "In progress"], ["done", "Completed"], ["all", "All"]]} />
        <button className="btn" onClick={() => newChallenge()}><Ic n="plus" s={15} />Challenge</button>
        <button className="btn fill" onClick={() => newGoal("day", today)}><Ic n="plus" s={15} />Goal</button>
      </div>
      <div className="gpgs">
        <div className="gring" role="img" aria-label={`${Math.round(pct * 100)}% of goals completed`}>
          <svg viewBox="0 0 52 52"><circle className="bg" cx="26" cy="26" r={R} /><circle className="fg" cx="26" cy="26" r={R} strokeDasharray={`${pct * CIRC} ${CIRC}`} /></svg>
          <b>{Math.round(pct * 100)}%</b>
        </div>
        <div className="gnum"><b>{total - doneN}</b><small>in progress</small></div>
        <div className="gnum"><b>{doneN}</b><small>completed</small></div>
        {overdue > 0 && <div className="gnum late"><b>{overdue}</b><small>overdue</small></div>}
      </div>
      {dueG.length + dueC.length > 0 && (
        <section className="gsec wide gdue">
          <div className="gsech"><h3>Due today</h3><span className="cnt">{dueDone}/{dueG.length + dueC.length}</span></div>
          <div className="dues">
            {dueG.map((g) => <label key={"g" + g.id} className={"due" + (g.done ? " done" : "")}><input type="checkbox" checked={g.done} onChange={() => toggleGoal(g.id)} />{g.title}</label>)}
            {dueC.map(({ c, s }) => { const on = c.checks.includes(tk); return <label key={"c" + c.id} className={"due" + (on ? " done" : "")}><input type="checkbox" style={{ "--cc": "#ec4899" }} checked={on} onChange={() => toggleCheck(c.id, tk)} />{c.title}<small>Day {s.dayNo}/{c.days}</small></label>; })}
          </div>
        </section>
      )}
      <div className="gpgrid">
        {challenges.length > 0 && !ql && <Heat challenges={challenges} />}
        <section className="gsec wide">
          <div className="gsech"><h3>Challenges</h3><span className="cnt">{chRows.length}</span><div className="sp" /><button className="ib sm" onClick={() => newChallenge()} aria-label="New challenge"><Ic n="plus" s={15} /></button></div>
          {chRows.map(({ c, s }) => (
            <button key={c.id} className={"gpc" + (chDone(s) ? " end" : "")} onClick={() => openChallenge(c)}>
              <span className="tt"><span className="gtt">{c.title}</span><small>{s.complete ? "Complete" : s.finished ? `Ended · ${s.inRange} of ${c.days} days` : s.upcoming ? `Starts ${fmtK(c.start)}` : `Day ${s.dayNo} of ${c.days}${s.streak > 0 ? ` · ${s.streak}-day streak` : ""}`}</small></span>
              <span className="gpcp"><span className="prog w pk"><i style={{ width: s.pct * 100 + "%" }} /></span><small>{Math.round(s.pct * 100)}%</small></span>
              <Ic n="right" s={16} />
            </button>
          ))}
          {!chRows.length && <div className="gempty">{chs.length ? emptyTxt : "Build a streak. Start a 21, 30 or 75 day challenge."}</div>}
        </section>
        {SECS.map(([lv, label]) => {
          const list = rows(lv);
          return (
            <section key={lv} className="gsec">
              <div className="gsech"><h3>{label}</h3><span className="cnt">{list.length}</span><div className="sp" /><button className="ib sm" onClick={() => newGoal(lv, today)} aria-label={`Add ${lv} goal`}><Ic n="plus" s={15} /></button></div>
              {list.map((g) => {
                const [txt, tone] = when(g);
                return (
                  <div key={g.id} className={"gpr" + (g.done ? " done" : "")}>
                    <input type="checkbox" checked={g.done} onChange={() => toggleGoal(g.id)} aria-label={`Mark done: ${g.title}`} />
                    <span className="tt"><button className="gtt" onClick={() => editGoal(g)}>{g.title}</button><small className={"when " + tone}>{txt}</small></span>
                    <button className="ib sm go" onClick={() => show(g)} aria-label="Show in calendar" title="Show in calendar"><Ic n="ext" s={15} /></button>
                    <button className="ib sm go goal-delete" onClick={() => deleteGoal(g.id)} aria-label={`Delete goal: ${g.title}`} title="Delete goal"><Ic n="trash" s={14} /></button>
                  </div>
                );
              })}
              {!list.length && <div className="gempty">{emptyTxt}</div>}
            </section>
          );
        })}
        <section className="gsec wide">
          <div className="gsech"><h3>Long-range plans</h3><span className="cnt">{planRows.length}</span><div className="sp" /><button className="ib sm" onClick={() => openRange(mk, mk, "goal")} aria-label="Add plan"><Ic n="plus" s={15} /></button></div>
          {planRows.map((i) => (
            <div key={i.id} className={"gpr" + (i.done ? " done" : "")}>
              <input type="checkbox" checked={i.done} onChange={() => toggleItem(i.id)} aria-label={`Mark done: ${i.title}`} />
              <span className="tt"><button className="gtt" onClick={() => setModal({ type: "range", data: i })}>{i.title}</button><small className={"when " + (late(i) ? "late" : "")}>{fmtK(i.start)} to {fmtK(i.end)}{late(i) ? " · overdue" : ""}</small></span>
              <button className="ib sm go" onClick={() => go("month", parse(i.start))} aria-label="Show in calendar" title="Show in calendar"><Ic n="ext" s={15} /></button>
            </div>
          ))}
          {!planRows.length && <div className="gempty">{emptyTxt}</div>}
        </section>
      </div>
    </div>
  );
}

/* ---------- modals ---------- */
function Modal({ title, close, children }) {
  return (
    <div className="ov" onMouseDown={close}>
      <div className="md-box" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") document.querySelector(".md-box .btn.fill")?.click(); }}>
        <div className="mt"><span>{title}</span><button className="ib sm" onClick={close} aria-label="Close"><Ic n="x" s={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

function CalendarModal({ data, close, save, del }) {
  const [f, setF] = useState(data);
  const name = f.name.trim();
  return (
    <Modal title={f.id ? "Edit calendar" : "New calendar"} close={close}>
      <input className="ti" autoFocus placeholder="Calendar name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="cal-form-color">
        <span>Calendar color</span>
        <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Calendar color" />
      </label>
      {f.id && <small className="cal-form-help">Deleting this calendar moves its events to My calendar.</small>}
      <div className="act">
        {f.id && <button className="btn red" onClick={() => del(f.id)}>Delete</button>}
        <div className="sp" />
        <button className="btn fill" disabled={!name} onClick={() => { save({ ...f, name }); close(); }}>Save</button>
      </div>
    </Modal>
  );
}

function EventModal({ data, calendars, calendarColor, close, save, del }) {
  const [f, setF] = useState(data);
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <Modal title={f.id ? "Edit event" : "New event"} close={close}>
      <input className="ti" autoFocus placeholder="Add title" value={f.title} onChange={(e) => set("title", e.target.value)} />
      <div className="fr"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
        {!f.allDay && <><input type="time" value={f.start} onChange={(e) => set("start", e.target.value)} /> – <input type="time" value={f.end} onChange={(e) => set("end", e.target.value)} /></>}
      </div>
      <label className="ck"><input type="checkbox" checked={f.allDay} onChange={(e) => set("allDay", e.target.checked)} /> All day</label>
      <div className="fr">
        <select value={f.cal} onChange={(e) => set("cal", e.target.value)}>{calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <i className="dot" style={{ background: calendarColor(f.cal) }} />
      </div>
      <textarea placeholder="Add description" value={f.desc} onChange={(e) => set("desc", e.target.value)} />
      <div className="act">
        {f.id && <button className="btn red" onClick={() => { del(f.id); close(); }}>Delete</button>}
        <div className="sp" />
        <button className="btn fill" onClick={() => { save({ ...f, title: f.title || "(No title)" }); close(); }}>Save</button>
      </div>
    </Modal>
  );
}

function GoalModal({ data, close, save, del }) {
  const [f, setF] = useState(data);
  const set = (k, v) => setF({ ...f, [k]: v });
  const hint = { day: "Applies to this date", month: `Applies to ${MONTHS[parse(f.date).getMonth()]} ${parse(f.date).getFullYear()}`, year: `Applies to ${parse(f.date).getFullYear()}`, decade: `Applies to ${decadeOf(parse(f.date).getFullYear())}s` }[f.level];
  return (
    <Modal title={f.id ? "Edit goal" : "New goal"} close={close}>
      <input className="ti" autoFocus placeholder="What do you want to achieve?" value={f.title} onChange={(e) => set("title", e.target.value)} />
      <Seg value={f.level} onChange={(v) => set("level", v)} options={LEVELS} />
      <div className="fr"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /><small>{hint}</small></div>
      <label className="ck"><input type="checkbox" checked={f.done} onChange={(e) => set("done", e.target.checked)} /> Completed</label>
      <div className="act">
        {f.id && <button className="btn red" onClick={() => { del(f.id); close(); }}>Delete</button>}
        <div className="sp" />
        <button className="btn fill" onClick={() => { if (f.title.trim()) { save(f); close(); } }}>Save</button>
      </div>
    </Modal>
  );
}

const CH_TPL = [["No sugar", "No added sugar, including drinks", 30], ["Read daily", "Read 10 pages", 21], ["Workout", "30 minutes of movement", 30], ["Early rise", "Up by 6 AM", 21], ["Meditate", "10 minutes, no phone", 21], ["75 Hard", "2 workouts, 4 L water, read 10 pages, no cheat meals", 75]];
const CH_NOTE = { 21: "Classic habit-building sprint", 30: "One-month challenge", 66: "Often cited average for forming a habit", 75: "Popular 75-day format", 100: "100 days of consistency", 365: "A full year" };
function ChallengeModal({ data, close, save, del }) {
  const [f, setF] = useState(data);
  const set = (k, v) => setF({ ...f, [k]: v });
  const days = Math.max(1, Math.min(3650, Math.round(+f.days) || 1));
  const end = dk(addDays(parse(f.start), days - 1));
  const st = f.id ? cStats({ ...f, days }) : null;
  return (
    <Modal title={f.id ? "Edit challenge" : "New challenge"} close={close}>
      <input className="ti" autoFocus placeholder="e.g. 75 Hard, No sugar, Read daily" value={f.title} onChange={(e) => set("title", e.target.value)} />
      {!f.id && <div className="presets">{CH_TPL.map(([t, n, d]) => <button key={t} className="btn sm" onClick={() => setF({ ...f, title: t, note: n, days: d })}>{t}</button>)}</div>}
      <div className="lbl">Duration</div>
      <div className="presets">
        {[21, 30, 66, 75, 100, 365].map((n) => <button key={n} className={"btn sm" + (days === n ? " on" : "")} onClick={() => set("days", n)}>{n}</button>)}
        <span className="cust"><input type="number" min="1" max="3650" value={f.days} onChange={(e) => set("days", e.target.value)} aria-label="Custom number of days" /><small>days</small></span>
      </div>
      <small className="hint">{CH_NOTE[days] || `${days}-day challenge`}</small>
      <div className="fr" style={{ marginTop: 12 }}><input type="date" value={f.start} onChange={(e) => e.target.value && set("start", e.target.value)} /><small>→ ends {fmtK(end)}</small></div>
      <textarea placeholder="What counts each day? e.g. 2 workouts, 4 L water, read 10 pages" value={f.note} onChange={(e) => set("note", e.target.value)} />
      {st && (
        <div className="cstat">
          <div><b>{st.upcoming ? "–" : st.dayNo}</b><small>of {days} days</small></div>
          <div><b>{st.inRange}</b><small>checked in</small></div>
          <div><b>{st.streak}</b><small>day streak</small></div>
          <div><b>{st.missed}</b><small>missed</small></div>
        </div>
      )}
      <div className="act">
        {f.id && <button className="btn red" onClick={() => { del(f.id); close(); }}>Delete</button>}
        <div className="sp" />
        <button className="btn fill" onClick={() => { save({ ...f, days, title: f.title.trim() || `${days}-day challenge` }); close(); }}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------- styles ---------- */
const CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
/* ============ TOKENS ============ */
.gc{
color-scheme:light;
--app:#f1f3f9;--bg:#fff;--soft:#f7f8fc;--raise:#fff;--tile:var(--soft);
--hover:rgba(46,55,82,.065);--line:rgba(46,55,82,.13);--grid:rgba(46,55,82,.09);--wk:rgba(79,70,229,.035);
--fg:#171923;--mute:#4d5668;--faint:#70798b;--track:rgba(46,55,82,.12);--fill:rgba(46,55,82,.075);--thumb:#fff;--cellbg:rgba(46,55,82,.1);--scroll:rgba(46,55,82,.2);
--ac:#4f46e5;--onac:#fff;--tx:50%;
--red:#e11d48;--rfg:#be123c;--gfg:#8a5a00;
--rbg:color-mix(in srgb,#e11d48 11%,var(--bg));--gbg:color-mix(in srgb,#f59e0b 16%,var(--bg));
--sh1:0 1px 2px rgba(15,23,42,.06);
--sh2:0 1px 2px rgba(15,23,42,.05),0 10px 28px -8px rgba(15,23,42,.14);
--sh3:0 0 0 1px rgba(15,23,42,.06),0 24px 64px -12px rgba(15,23,42,.34),0 8px 16px -8px rgba(15,23,42,.14);
--ach:color-mix(in srgb,var(--ac) 88%,#000);
--ab:color-mix(in srgb,var(--ac) 9%,var(--bg));--ab2:color-mix(in srgb,var(--ac) 18%,var(--bg));--ab3:color-mix(in srgb,var(--ac) 34%,var(--bg));--ab4:color-mix(in srgb,var(--ac) 52%,var(--bg));
--ac2:color-mix(in srgb,var(--ac) 82%,#000);--ac3:color-mix(in srgb,var(--ac) 65%,#000)}
.gc.dark{color-scheme:dark;
--app:#0a0b0e;--bg:#101216;--soft:#14171c;--raise:#181b21;
--tile:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012)),var(--bg);
--hover:rgba(255,255,255,.055);--line:rgba(255,255,255,.085);--grid:rgba(255,255,255,.05);--wk:rgba(255,255,255,.017);
--fg:#eceef2;--mute:#9399a6;--faint:#646a77;--track:rgba(255,255,255,.1);--fill:rgba(255,255,255,.07);--thumb:#2c3038;--cellbg:rgba(255,255,255,.09);--scroll:rgba(255,255,255,.16);
--ac:#6366f1;--tx:62%;--red:#fb7185;--rfg:#fda4af;--gfg:#fbbf24;
--sh1:0 1px 2px rgba(0,0,0,.4);
--sh2:0 1px 2px rgba(0,0,0,.4),0 12px 30px -8px rgba(0,0,0,.55);
--sh3:0 0 0 1px rgba(255,255,255,.07),0 28px 72px -12px rgba(0,0,0,.75),0 8px 20px -8px rgba(0,0,0,.5);
--ach:color-mix(in srgb,var(--ac) 86%,#fff);
--ac2:color-mix(in srgb,var(--ac) 55%,#fff);--ac3:color-mix(in srgb,var(--ac) 40%,#fff)}

/* ============ BASE / TYPE ============ */
.gc{font-family:"Inter",-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;font-feature-settings:"cv11","calt";-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;color:var(--fg);background:var(--app);height:100vh;display:flex;flex-direction:column;font-size:13px;line-height:1.4;letter-spacing:-.006em}
.gc *{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:var(--scroll) transparent}
.gc ::-webkit-scrollbar{width:10px;height:10px}.gc ::-webkit-scrollbar-thumb{background:var(--scroll);border-radius:10px;border:3px solid transparent;background-clip:content-box}
:where(.gc button){font:inherit;cursor:pointer;border:0;background:none;color:inherit;padding:0}
.gc kbd{font-family:inherit;font-size:10.5px;font-weight:500;color:var(--mute);background:var(--fill);border-radius:5px;padding:1px 5px;line-height:1.5;letter-spacing:0}
.gc button:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.sp{flex:1}.rel{position:relative}.blue{color:var(--ac2)}.hint{color:var(--mute);font-size:12px}
.num,.md,.hours div,.ev small,.chip small{font-variant-numeric:tabular-nums}
@keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes zoom{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes rise{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes dfade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--red) 55%,transparent)}50%{box-shadow:0 0 0 4px transparent}}
@keyframes month-in{from{opacity:.55;transform:translateX(var(--month-offset,12px))}to{opacity:1;transform:translateX(0)}}
@keyframes drawer-in{from{opacity:.7;transform:translateX(-18px)}to{opacity:1;transform:translateX(0)}}

/* ============ BUTTONS & CONTROLS ============ */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--raise);box-shadow:var(--sh1);color:var(--fg);font-weight:500;white-space:nowrap;transition:background .15s,border-color .15s,transform .1s,box-shadow .15s}
.btn:hover{background:color-mix(in srgb,var(--raise) 93%,var(--fg));border-color:color-mix(in srgb,var(--line) 55%,var(--faint))}.btn:active{transform:translateY(.5px)}
.btn.on{background:var(--ab);border-color:var(--ab2);color:var(--ac2)}.btn.on:hover{background:var(--ab2)}
.btn.fill{background:var(--ac);border-color:transparent;color:var(--onac);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.22)}.btn.fill:hover{background:var(--ach)}
.btn.red{color:var(--red);background:transparent;border-color:transparent;box-shadow:none}.btn.red:hover{background:var(--rbg)}
.btn.vb{padding:0 8px 0 12px;gap:4px}
.ib{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;color:var(--mute);transition:background .15s,color .15s}.ib:hover{background:var(--hover);color:var(--fg)}.ib.sm{width:26px;height:26px;border-radius:7px}
.link{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--ac2);padding:3px 8px;border-radius:7px;transition:background .15s}.link:hover{background:var(--ab)}
.iseg{position:relative;display:inline-grid;grid-template-columns:repeat(var(--n),1fr);padding:3px;border-radius:10px;background:var(--fill)}
.iseg .thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/var(--n));border-radius:7px;background:var(--thumb);box-shadow:0 1px 3px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.06);transform:translateX(calc(var(--i)*100%));transition:transform .28s cubic-bezier(.3,.9,.3,1)}
.iseg button{position:relative;z-index:1;padding:5px 14px;font-size:12.5px;font-weight:500;border-radius:7px;white-space:nowrap;color:var(--mute);transition:color .15s}.iseg button:hover{color:var(--fg)}.iseg button.on{color:var(--fg);font-weight:600}
.iseg.glass{background:rgba(255,255,255,.16);display:grid;backdrop-filter:blur(8px)}.iseg.glass .thumb{background:rgba(255,255,255,.95)}.iseg.glass button{color:rgba(255,255,255,.85)}.iseg.glass button.on{color:#1a1633}
.swt{width:38px;height:22px;border-radius:11px;background:var(--track);position:relative;transition:background .2s;flex-shrink:0}
.swt::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .25s cubic-bezier(.3,.9,.3,1)}
.swt.on{background:var(--ac)}.swt.on::after{transform:translateX(16px)}
.gc input[type=checkbox]{appearance:none;-webkit-appearance:none;width:18px;height:18px;border-radius:6px;border:1.5px solid var(--faint);display:inline-grid;place-items:center;margin:0;cursor:pointer;flex-shrink:0;background:transparent;transition:background .15s,border-color .15s}
.gc input[type=checkbox]:hover{border-color:var(--cc,var(--ac))}
.gc input[type=checkbox]:checked{background:var(--cc,var(--ac));border-color:var(--cc,var(--ac))}
.gc input[type=checkbox]:checked::after{content:"";width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
.gc input[type=date],.gc input[type=time],.gc select,.gc textarea{height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:inherit;transition:border-color .15s,box-shadow .15s}
.gc textarea{height:76px;padding:8px 10px;resize:none;width:100%}
.gc input:focus,.gc select:focus,.gc textarea:focus{outline:0;border-color:var(--ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 22%,transparent)}
.gc input::placeholder,.gc textarea::placeholder{color:var(--faint)}
.gc .ti:focus{box-shadow:0 1px 0 var(--ac)}

/* ============ HEADER ============ */
.top{display:flex;align-items:center;gap:6px;height:56px;padding:0 14px;flex-shrink:0}
.top h1{font-size:18px;font-weight:600;letter-spacing:-.025em;margin:0 6px 0 10px;white-space:nowrap}.top h1 span{color:var(--mute);font-weight:500}
.logo{display:flex;align-items:center;gap:10px;margin:0 14px 0 2px;font-size:15px;font-weight:600;letter-spacing:-.02em}
.logo-d{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#fff;font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--ac),color-mix(in srgb,var(--ac) 55%,#c026d3));box-shadow:0 2px 8px color-mix(in srgb,var(--ac) 40%,transparent),inset 0 1px 0 rgba(255,255,255,.3)}
.navp{display:flex;gap:2px}
.agechip{display:inline-flex;align-items:center;height:22px;background:var(--ab);color:var(--ac2);border-radius:999px;padding:0 9px;font-size:11.5px;font-weight:600;white-space:nowrap}
.spill{display:flex;align-items:center;gap:8px;height:32px;padding:0 6px 0 10px;border-radius:8px;background:var(--raise);border:1px solid var(--line);box-shadow:var(--sh1);color:var(--mute);min-width:240px;transition:border-color .15s,background .15s}
.spill:hover{border-color:color-mix(in srgb,var(--line) 55%,var(--faint))}.spill span{flex:1;text-align:left}
.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:196px;padding:5px;border-radius:12px;background:color-mix(in srgb,var(--raise) 92%,transparent);backdrop-filter:blur(20px) saturate(1.5);border:1px solid var(--line);box-shadow:var(--sh3);animation:pop .14s ease-out;transform-origin:top right}
.menu button{display:flex;justify-content:space-between;align-items:center;width:100%;padding:7px 10px;border-radius:7px;text-align:left;font-weight:500}.menu button:hover{background:var(--hover)}.menu button.cur{background:var(--ab);color:var(--ac2)}
.menu.wide{width:300px;padding:8px 10px}.clickaway{position:fixed;inset:0;z-index:25}
.setrow{display:flex;justify-content:space-between;align-items:center;padding:9px 4px;font-weight:500}.setrow.sep{border-top:1px solid var(--line);margin-top:6px;padding-top:12px}
.sw{display:flex;gap:9px}.sw button{width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);transition:transform .15s}.sw button:hover{transform:scale(1.12)}.sw .on{box-shadow:0 0 0 2px var(--raise),0 0 0 4px var(--fg)}

/* ============ FOCUS MODE ============ */
.fbadge{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border-radius:999px;background:var(--ab);color:var(--ac2);font-size:12px;font-weight:600}
.fbadge i{width:6px;height:6px;border-radius:50%;background:var(--ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 25%,transparent)}
.focus .top{height:64px;padding:0 clamp(16px,3vw,32px)}.focus .top h1{font-size:24px;letter-spacing:-.03em;margin-left:0}
.focus .body{padding:0 clamp(16px,3vw,32px) 96px}
.dock{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:4px;padding:6px;border-radius:16px;background:color-mix(in srgb,var(--raise) 86%,transparent);backdrop-filter:blur(24px) saturate(1.6);border:1px solid var(--line);box-shadow:var(--sh3);animation:rise .3s cubic-bezier(.2,.9,.3,1)}
.dock .btn{box-shadow:none;border-color:transparent;background:transparent}.dock .btn:hover{background:var(--hover)}
.focus .toast{bottom:100px}
.dsep{width:1px;height:20px;background:var(--line);margin:0 6px}

/* ============ SIDEBAR ============ */
.body{flex:1;display:flex;min-height:0;gap:12px;padding:0 12px 12px}
.side{width:252px;flex-shrink:0;overflow:auto;padding:4px 2px 0}
.create{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:40px;border-radius:11px;background:var(--ac);color:var(--onac);font-weight:600;font-size:13.5px;margin-bottom:18px;box-shadow:0 1px 2px rgba(0,0,0,.2),0 8px 20px -6px color-mix(in srgb,var(--ac) 55%,transparent),inset 0 1px 0 rgba(255,255,255,.22);transition:background .15s,transform .12s}
.create:hover{background:var(--ach);transform:translateY(-1px)}.create:active{transform:none}
.mini{margin-bottom:4px}.mh{display:flex;align-items:center;margin-bottom:6px}.mh b{flex:1;font-weight:600;font-size:13px;padding-left:6px;letter-spacing:-.01em}
.mg{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}
.dow{font-size:10px;font-weight:600;color:var(--mute);padding:4px 0;text-transform:uppercase;letter-spacing:.04em}
.md{position:relative;aspect-ratio:1;font-size:11.5px;border-radius:8px;color:var(--fg);margin:1px;padding:0;display:grid;place-items:center;transition:background .12s}.md:hover{background:var(--hover)}
.md.dim{color:var(--faint)}.md.hide{visibility:hidden}
.md.today{background:var(--ac);color:var(--onac);font-weight:600}.md.today:hover{background:var(--ach)}
.md.sel{background:var(--ab2);color:var(--ac2);font-weight:600}
.md.pick{background:var(--ab2)!important;color:var(--ac3)}
.md.has::after{content:"";position:absolute;bottom:3px;left:50%;width:3px;height:3px;border-radius:50%;background:var(--ac);transform:translateX(-50%)}.md.today.has::after{background:var(--onac)}
.cals{margin-top:18px}.cal-head{display:flex;align-items:center;justify-content:space-between;margin:0 2px 6px 0}.cals h3{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:0 0 0 6px}
.cal-row{display:flex;align-items:center;gap:2px;border-radius:8px}.cal-row:hover{background:var(--hover)}
.cals label{display:flex;gap:10px;align-items:center;min-width:0;flex:1;padding:6px;border-radius:8px;cursor:pointer;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cal-edit{opacity:.65}.cal-edit:hover{opacity:1}
.cal-form-color{display:flex;align-items:center;gap:10px;margin:2px 0 12px;font-size:13px;font-weight:500;color:var(--mute)}
.cal-form-color input{width:38px;height:34px;padding:3px;border-radius:8px;border:1px solid var(--line);background:var(--soft);cursor:pointer}
.cal-form-help{display:block;color:var(--mute);font-size:12px;margin:0 0 12px}
.card{border:1px solid var(--line);background:var(--tile);border-radius:14px;padding:14px;margin-top:12px;box-shadow:var(--sh1)}
.pring{display:flex;gap:12px;align-items:center}.pring svg{width:44px;height:44px;transform:rotate(-90deg);flex-shrink:0}.pring circle{fill:none;stroke-width:4.5}.pring .bg{stroke:var(--track)}.pring .fg{stroke:var(--ac);stroke-linecap:round;transition:stroke-dasharray .4s}
.tc .hr{height:1px;background:var(--line);margin:12px 0}.tc .hint{font-size:12px}.tc b{font-weight:600}

/* ============ MAIN PANEL ============ */
.main{flex:1;min-width:0;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:16px;box-shadow:var(--sh1)}
.gc.dark .main{box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.num{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:8px;font-size:12px;font-weight:500;padding:0 5px;margin-bottom:3px;transition:background .12s}
.num:hover{background:var(--hover)}.num.today{background:var(--ac);color:var(--onac);font-weight:600}.num.today:hover{background:var(--ach)}
.num.big{font-size:20px;font-weight:500;width:40px;height:40px;border-radius:12px;margin:2px 0 0}

/* month */
.month{height:100%;display:flex;flex-direction:column;min-width:560px;animation:month-in .22s cubic-bezier(.2,.8,.2,1) both}
.mrow.head{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;padding:11px 0 9px;color:var(--mute);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--line)}
.mcells{flex:1;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(6,minmax(0,1fr))}
.month-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-height:0;min-width:0}
.cell{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:6px 6px 3px;min-height:0;overflow:hidden;cursor:pointer;transition:background .12s}
.month-week>.cell{display:flex;flex-direction:column;min-width:0;padding:0 6px 3px}
.month-week>.cell>.num{flex:none;height:24px;margin:0;align-self:flex-start}
.month-range-space{height:calc(var(--range-lanes)*20px);flex:none}
.month-cell-items{min-height:0;overflow:hidden}
.month-week>div:not(.cell){z-index:2;min-width:0}
.range-chip{width:100%;height:20px;margin:0;border-radius:0;cursor:pointer}
.range-chip.starts{border-radius:5px 0 0 5px}
.range-chip.ends{border-radius:0 5px 5px 0}
.range-chip.starts.ends{border-radius:5px}
.month-week>.cell.last-col{border-right:0}.month-week>.cell.last-week{border-bottom:0}
.cell:hover{background:var(--hover)}.cell.we{background:var(--wk)}.cell.we:hover{background:var(--hover)}
.cell.dim .num{color:var(--faint)}.cell.dim .chip,.cell.dim .gchip{opacity:.55}
.cell.pick,.cell.pick:hover{background:var(--ab);user-select:none}
.chip,.gchip{display:flex;align-items:center;gap:6px;height:20px;border-radius:5px;padding:0 6px;margin-bottom:2px;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden}
.chip{--c:var(--ac);color:var(--fg);transition:background .12s}.chip:hover{background:color-mix(in srgb,var(--c) 14%,transparent)}
.chip i,.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;display:inline-block;background:var(--c)}
.chip small{color:var(--mute);font-weight:500;font-size:11px}
.chip span:last-child,.gchip span:last-child,.bar .bt{min-width:0;overflow:hidden;text-overflow:ellipsis}
.chip.ad{background:color-mix(in srgb,var(--c) 17%,var(--bg));color:color-mix(in srgb,var(--c) var(--tx),var(--fg));box-shadow:inset 2px 0 0 var(--c);padding-left:8px}.chip.ad:hover{background:color-mix(in srgb,var(--c) 26%,var(--bg))}
.gchip{background:var(--gbg);color:var(--gfg);transition:filter .12s}.gchip:hover{filter:brightness(.96)}
.gk{width:12px;height:12px;border-radius:50%;border:1.5px solid currentColor;flex-shrink:0;display:inline-grid;place-items:center;opacity:.85;transition:transform .12s}.gk:hover{transform:scale(1.15)}
.done>.gk,.done .gk{background:currentColor}.done>.gk::after,.done .gk::after{content:"";width:3px;height:6px;border:solid var(--bg);border-width:0 1.5px 1.5px 0;transform:rotate(45deg) translate(-.5px,-.5px)}
.gchip.done,.gr.done span,.gl.done{opacity:.6}.gchip.done span:last-child,.gr.done span,.gl.done{text-decoration:line-through}
.more{font-size:11px;font-weight:600;color:var(--mute);padding:1px 6px;border-radius:5px;cursor:pointer;display:inline-block}.more:hover{background:var(--hover);color:var(--fg)}
.bday{font-size:11px;font-weight:500;background:var(--gbg);color:var(--gfg);border-radius:5px;padding:1px 6px;margin-bottom:2px}

/* day / week */
.tg{display:flex;flex-direction:column;height:100%;min-width:480px}
.tg-head,.allday,.tg-body{display:grid}
.dh{text-align:center;padding:10px 0 8px;cursor:pointer;border-left:1px solid var(--line);transition:background .12s}.dh:hover{background:var(--hover)}
.dh small{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}.dh small.blue{color:var(--ac2)}
.allday{border-top:1px solid var(--line);border-bottom:1px solid var(--line);min-height:30px}.allday>div{border-left:1px solid var(--line);padding:3px}
.tz{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);text-align:right;padding:7px 8px 0 0!important;border:0!important}
.tg-scroll{flex:1;overflow:auto}
.hours div{height:48px;font-size:10.5px;color:var(--mute);text-align:right;padding-right:10px;transform:translateY(-7px)}
.col{position:relative;height:1152px;border-left:1px solid var(--line);background:repeating-linear-gradient(var(--bg) 0 47px,var(--grid) 47px 48px)}
.col.we{background:repeating-linear-gradient(var(--wk) 0 47px,var(--grid) 47px 48px),var(--bg)}
.ev{--c:var(--ac);position:absolute;left:3px;right:6px;border-radius:7px;background:color-mix(in srgb,var(--c) 16%,var(--bg));color:color-mix(in srgb,var(--c) var(--tx),var(--fg));box-shadow:inset 3px 0 0 var(--c);padding:4px 8px 4px 11px;font-size:12px;line-height:1.3;overflow:hidden;cursor:pointer;transition:background .15s,transform .15s}
.ev:hover{background:color-mix(in srgb,var(--c) 25%,var(--bg))}.ev b{font-weight:600}.ev small{opacity:.8;font-size:11px}
.now{position:absolute;left:0;right:0;border-top:2px solid var(--red);z-index:3}.now i{position:absolute;left:-5px;top:-6px;width:10px;height:10px;border-radius:50%;background:var(--red);animation:pulse 2.4s infinite}
.sel-box{position:absolute;left:3px;right:6px;background:color-mix(in srgb,var(--ac) 22%,transparent);border:1.5px solid var(--ac);border-radius:7px;pointer-events:none;z-index:2}

/* year */
.yv,.tl{user-select:none}
.yv{padding:20px 28px 28px}.yvh{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}.yvh h2{margin:0;font-size:32px;font-weight:600;letter-spacing:-.035em}
.yg{display:grid;grid-template-columns:repeat(auto-fill,minmax(214px,1fr));gap:14px}
.ym{border:1px solid var(--line);background:var(--tile);border-radius:14px;padding:14px;box-shadow:var(--sh1);transition:border-color .15s,transform .15s,box-shadow .15s}
.ym:hover{border-color:color-mix(in srgb,var(--ac) 35%,var(--line));box-shadow:var(--sh2)}
.ym h4{margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:-.01em;cursor:pointer}.ym h4:hover{color:var(--ac2)}
.prog{width:140px;height:5px;border-radius:999px;background:var(--track);overflow:hidden}.prog i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ac),color-mix(in srgb,var(--ac) 60%,#c026d3))}.prog.sm{width:80px}

/* decade / 20y / custom timeline */
.tl{padding:0 24px 48px}
.tlbar{position:sticky;top:0;z-index:7;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);display:flex;align-items:center;gap:12px;height:56px;border-bottom:1px solid var(--line)}
.tlbar .od{color:var(--red);font-weight:600}.rng{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.life{display:flex;align-items:center;gap:12px;padding:12px 16px;margin:16px 0 6px;flex-wrap:wrap;border:1px solid var(--line);border-radius:14px;background:var(--tile)}
.life small{color:var(--mute);font-size:12px}
.dec{margin-bottom:10px}
.dec .dhd{position:sticky;top:56px;z-index:5;background:var(--bg);display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 0 10px;margin:0}.dhd h2{margin:0;font-size:24px;font-weight:600;letter-spacing:-.03em}
.pill{display:inline-flex;align-items:center;background:var(--gbg);color:var(--gfg);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:500}.pill.done{text-decoration:line-through;opacity:.6}
.yr{display:grid;grid-template-columns:104px 1fr;gap:18px;padding:16px 18px;margin-bottom:10px;border:1px solid var(--line);border-radius:16px;background:var(--tile);box-shadow:var(--sh1);transition:border-color .15s}
.yr:hover{border-color:color-mix(in srgb,var(--ac) 30%,var(--line))}.yr.pre{opacity:.45}
.yr.cy{border-color:color-mix(in srgb,var(--ac) 50%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 11%,transparent)}
.rail{border:0;padding:0;text-align:left}.rail b{display:block;font-size:26px;font-weight:600;letter-spacing:-.035em;line-height:1.1}.rail small{color:var(--ac2);font-size:12px;font-weight:500}
.yr.cy .rail b{color:var(--ac2)}
.yt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;min-height:22px}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:var(--ab);color:var(--ac2);border-radius:6px;padding:2px 8px}.tag.bd{background:var(--gbg);color:var(--gfg)}.tag.star{background:#fbbf24;color:#3a2a00}
.ms,.bars{display:grid;grid-template-columns:repeat(12,1fr);gap:4px}.bars{margin-top:6px;row-gap:4px}
.mc{display:flex;flex-direction:column;align-items:center;gap:1px;padding:8px 0 6px;border-radius:9px;background:var(--bg);border:1px solid var(--line);font-size:12px;font-weight:500;min-width:0;transition:border-color .15s,transform .12s,background .15s}
.mc:hover{border-color:var(--ac);transform:translateY(-1px)}
.mc small{font-size:10px;color:var(--ac2);font-weight:500}.mc em{font-style:normal;font-size:10px;font-weight:600;color:var(--onac);background:var(--ac);border-radius:999px;min-width:16px;padding:0 5px;line-height:16px}
.mc.h1{background:var(--ab)}.mc.h2{background:var(--ab2)}.mc.h3{background:var(--ab3)}.mc.h4{background:var(--ab4)}
.mc.nowm{box-shadow:inset 0 0 0 1.5px var(--ac)}.mc.pick{background:var(--ac)!important;color:var(--onac);border-color:var(--ac)}.mc.pick small{color:var(--onac)}
.bar{--c:var(--ac);display:flex;align-items:center;gap:6px;height:22px;border-radius:6px;background:color-mix(in srgb,var(--c) 17%,var(--bg));color:color-mix(in srgb,var(--c) var(--tx),var(--fg));box-shadow:inset 3px 0 0 var(--c);padding:0 8px 0 10px;font-size:11.5px;font-weight:500;cursor:pointer;white-space:nowrap;overflow:hidden;transition:background .15s}
.bar:hover{background:color-mix(in srgb,var(--c) 27%,var(--bg))}.bar.done{opacity:.55}.bar.done .bt{text-decoration:line-through}

/* selection bar / toast */
.selbar{position:sticky;bottom:18px;z-index:8;pointer-events:none;display:flex;justify-content:center;margin-top:8px}
.selin{pointer-events:auto;display:flex;gap:6px;align-items:center;padding:7px 8px 7px 16px;border-radius:14px;background:color-mix(in srgb,var(--raise) 86%,transparent);backdrop-filter:blur(20px) saturate(1.6);border:1px solid var(--line);box-shadow:var(--sh3);animation:dfade .25s ease}
.selt{white-space:nowrap;margin-right:8px}.selt b{font-weight:600}.selt small{color:var(--mute)}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:8px 8px 8px 16px;border-radius:12px;display:flex;gap:14px;align-items:center;z-index:60;box-shadow:var(--sh3);font-weight:500}
.toast button{font-weight:600;padding:4px 10px;border-radius:7px;background:color-mix(in srgb,var(--bg) 16%,transparent)}.toast button:hover{background:color-mix(in srgb,var(--bg) 26%,transparent)}

/* ============ GOALS PANEL ============ */
.gp{width:304px;padding:0;overflow:hidden;display:flex;flex-direction:column;gap:12px;flex-shrink:0}
.gscroll{flex:1;min-height:0;overflow:auto;margin:0 -4px;padding:0 4px 4px}
.gp h3{font-size:15px;font-weight:600;letter-spacing:-.02em;margin:2px 2px 10px}
.gs{background:var(--tile);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px;box-shadow:var(--sh1)}
.gh{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.gh b{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.gr{display:flex;gap:10px;align-items:center;padding:6px 4px;border-radius:8px}.gr:hover{background:var(--hover)}.gr span{cursor:pointer;flex:1;font-weight:500}.gr small{font-size:11px;font-weight:600}
.goal-delete{color:var(--rfg);opacity:0;flex-shrink:0}.gr:hover .goal-delete,.gr:focus-within .goal-delete,.gpr:hover .goal-delete,.gpr:focus-within .goal-delete{opacity:1}
@media(hover:none){.goal-delete{opacity:1}}
.empty{color:var(--faint);font-size:12px;padding:2px 4px}
.mobile-fab{display:none}.drawer-actions{display:none}
.carry{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:34px;border-radius:10px;background:var(--ab);color:var(--ac2);margin-bottom:10px;font-weight:600;font-size:12.5px;transition:background .15s}.carry:hover{background:var(--ab2)}
.dcard{position:relative;overflow:hidden;flex-shrink:0;border-radius:18px;padding:14px 16px 16px;color:#fff;border:1px solid rgba(255,255,255,.14);
background:radial-gradient(90% 120% at 100% 0%,rgba(217,70,239,.5),transparent 58%),radial-gradient(110% 120% at 0% 100%,color-mix(in srgb,var(--ac) 75%,#000),transparent 62%),linear-gradient(160deg,color-mix(in srgb,var(--ac) 50%,#0b0b16),color-mix(in srgb,var(--ac) 22%,#14081f));
box-shadow:0 14px 32px -10px color-mix(in srgb,var(--ac) 55%,transparent),inset 0 1px 0 rgba(255,255,255,.18)}
.dcard::before{content:"“";position:absolute;right:12px;top:-30px;font:400 150px "Instrument Serif",Georgia,serif;opacity:.14;pointer-events:none}
.dtop{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.85;margin-bottom:10px}
.dref{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.16);color:#fff;transition:background .15s}.dref:hover{background:rgba(255,255,255,.3)}
.dtext{margin:16px 0 10px;font:400 21px/1.22 "Instrument Serif",Georgia,"Times New Roman",serif;letter-spacing:-.005em;min-height:104px;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;animation:dfade .35s ease}
.dtext.serif{font-size:19px;font-style:italic}.dsrc{font-size:12px;font-weight:500;opacity:.8}

/* ============ MODALS / PALETTE ============ */
.ov{position:fixed;inset:0;background:rgba(6,8,12,.5);backdrop-filter:blur(6px);display:grid;place-items:center;z-index:50;animation:fade .15s ease-out}
.md-box{background:var(--raise);border:1px solid var(--line);border-radius:18px;width:min(460px,94vw);padding:16px 22px 20px;box-shadow:var(--sh3);animation:zoom .2s cubic-bezier(.2,.9,.3,1)}
.mt{display:flex;justify-content:space-between;align-items:center;margin:0 -8px 10px 0}.mt span{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.ti{width:100%;border:0;border-bottom:1px solid var(--line);font-family:inherit;font-size:22px;font-weight:600;letter-spacing:-.02em;color:var(--fg);background:transparent;padding:6px 0 10px;margin-bottom:16px;outline:0;border-radius:0}.ti:focus{border-color:var(--ac)}
.fr{display:flex;gap:8px;align-items:center;margin-bottom:12px;color:var(--mute)}.fr small{color:var(--mute)}
.ck{display:flex;gap:10px;align-items:center;margin-bottom:12px;font-weight:500}
.act{display:flex;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.md-box .iseg{display:grid;width:100%;margin-bottom:14px}
.md-box .pi{margin:0;padding:9px 0;border-bottom:1px solid var(--line);cursor:default}.md-box .pi:last-child{border:0}.md-box .pi small{background:var(--fill);color:var(--fg);border-radius:6px;padding:1px 8px;font-weight:500}
.top-ov{place-items:start center;padding-top:14vh}
.pal{width:min(580px,92vw);overflow:hidden;background:var(--raise);border:1px solid var(--line);border-radius:16px;box-shadow:var(--sh3);padding-bottom:6px;animation:zoom .2s cubic-bezier(.2,.9,.3,1)}
.pal input{width:100%;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:16px 18px;font-size:15px;background:transparent;color:var(--fg);outline:0;margin-bottom:6px;height:auto}.pal input:focus{box-shadow:none;border-color:var(--line)}
.pi{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 12px;margin:0 6px;border-radius:9px;cursor:pointer;font-weight:500}.pi.on{background:var(--ab);color:var(--ac2)}.pi small{color:var(--mute);font-size:11.5px;white-space:nowrap;font-weight:500}.pi span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ============ LIFE IN WEEKS ============ */
.lw{height:100%;display:flex;flex-direction:column;padding:20px 28px;overflow:hidden}
.lwh{display:flex;gap:16px;align-items:center;margin-bottom:14px;flex-wrap:wrap}.lwh h2{margin:0;font-size:24px;font-weight:600;letter-spacing:-.03em}.lwh small{color:var(--mute);font-size:12px}
.lwbox{flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start}.lwwrap{display:flex;align-items:flex-start}
.lwa{display:grid;gap:2px;height:14px;margin-bottom:4px}.lwa small{font-size:10px;color:var(--mute);white-space:nowrap;width:0;overflow:visible}
.lwm{display:grid;gap:2px;margin:18px 6px 0 0}.lwm small{display:grid;place-items:center;font-size:9px;color:var(--mute);width:12px}
.lwg{display:grid;grid-auto-flow:column;gap:2px}.lwg i{border-radius:2px;background:var(--cellbg)}.lwg i.l{background:var(--ac)}.lwg i.c{background:var(--red);box-shadow:0 0 0 2px color-mix(in srgb,var(--red) 35%,transparent)}

/* ============ RESPONSIVE / MOTION ============ */
@media(max-width:900px){.daily,.spill span,.spill kbd{display:none}.spill{min-width:0;padding:0 10px}.rail b{font-size:20px}.yr{grid-template-columns:76px 1fr}}
@media(max-width:800px){.gp,.side{display:none}.side.mobile-drawer{display:block;position:fixed;z-index:41;inset:0 auto 0 0;width:min(320px,calc(100vw - 52px));padding:calc(18px + env(safe-area-inset-top)) 16px calc(18px + env(safe-area-inset-bottom));overflow-y:auto;background:var(--bg);box-shadow:var(--sh3);animation:drawer-in .22s cubic-bezier(.2,.8,.2,1)}.drawer-scrim{position:fixed;inset:0;z-index:40;background:rgba(8,10,16,.48);backdrop-filter:blur(2px)}.drawer-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:-8px 0 18px}.drawer-actions .btn{height:36px;font-size:12px}.logo span:last-child{display:none}.dock{max-width:96vw;overflow:auto}}
@media(max-width:600px){
  .gc{height:100dvh;min-height:100svh}
  .top:not(.focus-top){display:grid;grid-template-columns:40px minmax(0,1fr) 64px 60px;grid-template-rows:36px 34px;gap:4px;height:auto;min-height:78px;padding:6px 8px}
  .top:not(.focus-top)>.sidebar-toggle{grid-column:1;grid-row:1}
  .top:not(.focus-top)>.logo{display:none}
  .top:not(.focus-top)>.pg{grid-column:1 / 3;grid-row:2;justify-self:start;max-width:100%;margin:0}
  .top:not(.focus-top)>.pg button{padding:5px 10px;font-size:11px}
  .top:not(.focus-top)>.calendar-title{grid-column:2;grid-row:1;min-width:0;margin:0 4px;font-size:16px}
  .top:not(.focus-top)>.today-nav{grid-column:3;grid-row:1;height:30px;padding:0 8px;font-size:11px}
  .top:not(.focus-top)>.calendar-nav{grid-column:4;grid-row:1;gap:0}
  .top:not(.focus-top)>.calendar-nav .ib{width:28px;height:30px}
  .top:not(.focus-top)>.back-nav{grid-column:3;grid-row:1;height:30px;padding:0 7px}
  .top:not(.focus-top)>.agechip{display:none}
  .top:not(.focus-top)>.sp{display:none}
  .top:not(.focus-top)>.mobile-search{display:none}
  .top:not(.focus-top)>.view-picker{grid-column:3;grid-row:2;justify-self:start}
  .top:not(.focus-top)>.view-picker .btn{height:32px;padding:0 8px;font-size:11px}
  .top:not(.focus-top)>.focus-toggle,.top:not(.focus-top)>.theme-toggle{display:none}
  .top:not(.focus-top)>.cloud-account{grid-column:4;grid-row:2;justify-self:end;margin:0;padding:0;border:0}
  .top:not(.focus-top) .cloud-sync,.top:not(.focus-top) .cloud-email{display:none}
  .top:not(.focus-top)>.panel-toggle,.top:not(.focus-top)>.quote-toggle{display:none}
  .focus-top{height:auto;min-height:56px;padding:8px 12px;gap:8px;flex-wrap:wrap}
  .focus-top .calendar-title{font-size:18px}
  .focus-top .sp{display:none}
  .focus-top .cloud-account{margin-left:auto}
  .body{gap:0;padding:0 6px calc(6px + env(safe-area-inset-bottom))}
  .main{width:100%;border-radius:12px;min-height:0}
  .month{min-width:0;touch-action:pan-y}
  .drawer-actions{display:grid}
  .mobile-fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:25;width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:var(--ac);color:var(--onac);box-shadow:0 6px 18px color-mix(in srgb,var(--ac) 36%,transparent),0 2px 6px rgba(0,0,0,.18);transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s}
  .mobile-fab:active{transform:scale(.92)}
  .mobile-fab:focus-visible{outline:3px solid var(--ac);outline-offset:3px}
  .mrow.head{padding:8px 0 6px;font-size:9px}
  .month-week>.cell{padding:0 2px 2px}
  .month-week>.cell>.num{height:22px;min-width:20px;padding:0 3px;font-size:11px}
  .month-cell-items .chip,.month-cell-items .gchip{height:17px;font-size:9px;gap:2px;padding:0 3px}
  .month-cell-items .chip small{display:none}
  .month-cell-items .chip i{width:5px;height:5px}
  .month-week>div:not(.cell) .range-chip{height:20px;font-size:9px;padding:0 4px}
  .cdots{top:5px;right:3px;gap:2px}
  .cdot{width:7px;height:7px}
  .more{font-size:9px;padding:0 3px}
  .bday{font-size:8px;padding:0 2px}
  .gpg{padding:16px 12px 36px}
  .gpgh{gap:8px}
  .gpgh h2{font-size:24px}
  .gpgh .iseg{max-width:100%;overflow:auto}
  .gpgh .iseg button{padding:5px 8px;font-size:11px}
  .gpgs{gap:12px;justify-content:space-between;padding:12px;margin-bottom:12px}
  .gnum b{font-size:18px}
  .gpgrid{grid-template-columns:minmax(0,1fr);gap:10px}
  .gsec.wide{grid-column:auto}
  .gpr{gap:7px;padding:8px 4px}
  .gpr .go{opacity:1}
  .gpc{gap:8px;padding:9px 6px}
  .gpcp{width:72px;gap:5px}
  .gpcp small{width:28px;font-size:10px}
  .cv{padding:16px 12px 40px}
  .yv{padding:14px 12px 28px}
  .yr{grid-template-columns:58px minmax(0,1fr);gap:10px;padding:12px 10px}
  .rail b{font-size:20px}
  .tl{padding:0 12px 36px}
  .lw{padding:14px 10px}
  .dock{bottom:calc(10px + env(safe-area-inset-bottom));max-width:calc(100vw - 16px);overflow-x:auto}
  .ov{padding:10px;overflow-y:auto;place-items:center}
  .md-box{width:100%;max-height:calc(100dvh - 20px);overflow-y:auto;padding:14px 14px 16px;border-radius:14px}
  .ti{font-size:19px}
}
@media(max-width:360px){
  .top:not(.focus-top){grid-template-columns:36px minmax(0,1fr) 58px 54px;gap:3px;padding-inline:5px}
  .top:not(.focus-top)>.sidebar-toggle{width:34px}
  .top:not(.focus-top)>.pg button{padding:5px 8px}
  .top:not(.focus-top)>.today-nav{padding:0 5px}
  .top:not(.focus-top)>.calendar-nav .ib{width:25px}
  .top:not(.focus-top)>.cloud-account .cloud-signout{padding:0 5px;font-size:10px}
  .month-week>.cell>.num{font-size:10px}
  .month-cell-items .chip,.month-cell-items .gchip{font-size:8px}
}
@media(prefers-reduced-motion:reduce){.gc *{transition:none!important;animation:none!important}}

/* ============ v3 additions ============ */
.ib.live{background:var(--ab);color:var(--ac2)}
.gc input[type=checkbox]:disabled{opacity:.35;cursor:default}
.gc input[type=number]{height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:inherit}
.cell{position:relative}
.goalrow{display:grid;border-bottom:1px solid var(--line);min-height:34px}
.goalrow>div{position:relative;border-left:1px solid var(--line);padding:4px}
.gsum{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 8px;border-radius:7px;background:var(--gbg);color:var(--gfg);font-size:11.5px;font-weight:600;transition:filter .12s}
.gsum:hover{filter:brightness(.96)}
.gsum.all{background:color-mix(in srgb,#10b981 16%,var(--bg));color:color-mix(in srgb,#10b981 var(--tx),var(--fg))}
.gsum .gbar{flex:1;height:3px;border-radius:99px;background:color-mix(in srgb,currentColor 22%,transparent);overflow:hidden}.gsum .gbar i{display:block;height:100%;background:currentColor;border-radius:99px}
.gpop{position:absolute;top:calc(100% - 2px);left:4px;z-index:30;width:252px;padding:10px;border-radius:12px;background:var(--raise);border:1px solid var(--line);box-shadow:var(--sh3);animation:pop .14s ease-out;text-align:left}
.gpop.r{left:auto;right:4px}
.gpop h5{margin:0 0 6px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.gpop .gr small{font-size:11px;white-space:nowrap}
.chd{color:color-mix(in srgb,#ec4899 var(--tx),var(--fg))}
.gchip.ch{background:color-mix(in srgb,#ec4899 15%,var(--bg));color:color-mix(in srgb,#ec4899 var(--tx),var(--fg))}
.cdots{position:absolute;top:10px;right:8px;display:flex;gap:4px}
.cdot{width:9px;height:9px;padding:0;border-radius:50%;border:1.5px solid #ec4899;background:transparent;transition:transform .12s,background .12s}
.cdot:hover{transform:scale(1.35)}.cdot.on{background:#ec4899}.cdot.miss{border-color:var(--faint)}
.chr{padding:6px 4px;border-radius:8px}.chr:hover{background:var(--hover)}.chr.end{opacity:.6}
.chr1{display:flex;gap:10px;align-items:center}.chr1 span{flex:1;min-width:0;font-weight:500;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chr1 small,.chr2 small{font-size:11px;font-weight:600;color:var(--mute);white-space:nowrap}
.chr2{display:flex;align-items:center;gap:8px;margin:6px 0 0 28px}
.prog.w{width:auto;flex:1}.prog.pk i{background:linear-gradient(90deg,#ec4899,#a855f7)}
.presets{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}
.btn.sm{height:28px;padding:0 10px;font-size:12px}
.cust{display:inline-flex;align-items:center;gap:6px;margin-left:4px;color:var(--mute)}.cust input{width:76px;height:28px}
.lbl{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:4px 0 0}
.cstat{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:2px 0 4px}
.cstat div{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.cstat b{display:block;font-size:17px;font-weight:600;letter-spacing:-.02em}.cstat small{color:var(--mute);font-size:11px}

/* ============ v4: header, daily card, challenge view, goals page ============ */
.ib svg,.dref svg{display:block}
.top h1{min-width:0;overflow:hidden;text-overflow:ellipsis}
.logo{margin:0 10px 0 2px}
.iseg.pg{margin:0 8px 0 0}
.iseg.pg button{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 14px}

/* daily quote / verse card: one column, every row aligned to the same edges */
.dcard{display:flex;flex-direction:column;gap:12px;padding:14px 16px 16px}
.dcard::before{top:-34px;right:14px}
.dtop{display:flex;align-items:center;justify-content:space-between;gap:8px;height:28px;margin:0;font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;opacity:1}
.dtop span{opacity:.9;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dref{width:28px;height:28px;flex-shrink:0;border-radius:9px}
.dcard .iseg.glass{display:grid;width:100%}
.dcard .iseg.glass button{display:flex;align-items:center;justify-content:center;height:28px;padding:0}
.dq{margin:0;display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-height:136px}
.dtext{margin:0;min-height:0;text-align:left;text-wrap:pretty;-webkit-line-clamp:7}
.dsrc{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;opacity:.85}
.dsrc::before{content:"";width:16px;height:1px;background:currentColor;opacity:.6;flex-shrink:0}

/* panel header */
.gph{display:flex;align-items:center;justify-content:space-between;margin:2px 2px 10px}.gph h3{margin:0}
.chr.cur{background:var(--ab)}

/* isolated challenge view */
.cv{--chc:#ec4899;max-width:920px;margin:0 auto;padding:28px clamp(16px,3vw,36px) 56px}
.cv .btn.fill{background:var(--chc)}.cv .btn.fill:hover{background:color-mix(in srgb,var(--chc) 88%,#000)}
.cvh{display:flex;align-items:center;gap:24px;flex-wrap:wrap;padding:22px 24px;border:1px solid var(--line);border-radius:20px;background:var(--tile);box-shadow:var(--sh1)}
.cvring{position:relative;width:104px;height:104px;flex-shrink:0}
.cvring svg{display:block;width:100%;height:100%;transform:rotate(-90deg)}
.cvring circle{fill:none;stroke-width:8}.cvring .bg{stroke:var(--track)}
.cvring .fg{stroke:var(--chc);stroke-linecap:round;transition:stroke-dasharray .6s cubic-bezier(.3,.9,.3,1)}
.cvring b{position:absolute;inset:0;display:grid;place-items:center;font-size:22px;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.cvt{flex:1;min-width:220px}
.cvk{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:600;background:color-mix(in srgb,var(--chc) 14%,var(--bg));color:color-mix(in srgb,var(--chc) var(--tx),var(--fg))}
.cvt h2{margin:8px 0 2px;font-size:28px;font-weight:600;letter-spacing:-.035em;line-height:1.15;overflow-wrap:anywhere}
.cvd{margin:0;color:var(--mute)}
.cvn{margin:12px 0 0;padding:9px 12px;border-radius:10px;background:var(--soft);border:1px solid var(--line);max-width:62ch}
.cva{display:flex;gap:8px;align-items:center;margin-left:auto}
.cvs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0 18px}
.cvs>div{padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--tile)}
.cvs b{display:block;font-size:22px;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.cvs small{color:var(--mute);font-size:12px}
.cvl{margin:0 0 16px 2px;color:var(--mute)}
.cvw,.cvg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cvw{margin-bottom:6px}.cvw span{text-align:center;font-size:11px;font-weight:600;color:var(--mute)}
.ct{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;min-height:70px;padding:9px 10px;border-radius:12px;border:1px solid var(--line);background:var(--tile);text-align:left;color:var(--fg);transition:border-color .15s,background .15s,transform .1s}
.ct b{font-size:17px;font-weight:600;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.ct small{font-size:11px;color:var(--mute);white-space:nowrap}
.ct:not(:disabled):hover{border-color:var(--chc)}.ct:not(:disabled):active{transform:scale(.97)}
.ct.on{background:var(--chc);border-color:transparent;color:#fff}.ct.on small{color:rgba(255,255,255,.85)}
.ct.on::after{content:"";position:absolute;top:9px;right:11px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.ct.miss{border-style:dashed;background:transparent}.ct.miss b{color:var(--mute)}
.ct.tdy{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--chc)}
.ct.fut{opacity:.5;cursor:default}
.cvkey{display:flex;gap:18px;margin-top:16px;color:var(--mute);font-size:12px}
.cvkey span{display:inline-flex;align-items:center;gap:7px}
.cvkey i{width:12px;height:12px;border-radius:4px;border:1px solid var(--line)}
.cvkey i.on{background:var(--chc);border-color:transparent}.cvkey i.miss{border-style:dashed}.cvkey i.tdy{box-shadow:0 0 0 1.5px var(--chc);border-color:transparent}

/* goals page */
.gpg{max-width:1040px;margin:0 auto;padding:28px clamp(16px,3vw,36px) 56px}
.gpgh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.gpgh h2{margin:0;font-size:30px;font-weight:600;letter-spacing:-.035em}
.gpgs{display:flex;align-items:center;gap:28px;padding:14px 20px;border:1px solid var(--line);border-radius:16px;background:var(--tile);box-shadow:var(--sh1);margin-bottom:16px}
.gring{position:relative;width:52px;height:52px;flex-shrink:0}
.gring svg{display:block;width:100%;height:100%;transform:rotate(-90deg)}
.gring circle{fill:none;stroke-width:5}.gring .bg{stroke:var(--track)}.gring .fg{stroke:var(--ac);stroke-linecap:round;transition:stroke-dasharray .5s}
.gring b{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.gnum b{display:block;font-size:22px;font-weight:600;letter-spacing:-.03em;line-height:1.1;font-variant-numeric:tabular-nums}.gnum small{color:var(--mute);font-size:12px}
.gnum.late b,.gnum.late small{color:var(--rfg)}
.gpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:14px;align-items:start}
.gsec{border:1px solid var(--line);border-radius:16px;background:var(--tile);box-shadow:var(--sh1);padding:6px 6px 8px}.gsec.wide{grid-column:1/-1}
.gsech{display:flex;align-items:center;gap:8px;padding:8px 8px 6px 12px}
.gsech h3{margin:0;font-size:14.5px;font-weight:600;letter-spacing:-.015em}
.cnt{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--fill);color:var(--mute);font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums}
.gpr{display:flex;align-items:center;gap:12px;padding:8px 6px 8px 12px;border-radius:10px}.gpr:hover{background:var(--hover)}
.tt{display:flex;flex-direction:column;min-width:0;flex:1;text-align:left}
.gtt{display:block;max-width:100%;text-align:left;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.gtt:hover{color:var(--ac2)}
.tt small{color:var(--mute);font-size:12px}
.when.late{color:var(--rfg);font-weight:600}.when.here{color:var(--ac2);font-weight:600}
.gpr.done .gtt{text-decoration:line-through;opacity:.6}
.gpr .go{opacity:0;transition:opacity .15s}.gpr:hover .go,.gpr:focus-within .go{opacity:1}
@media(hover:none){.gpr .go{opacity:1}}
.gpc{display:flex;align-items:center;gap:16px;width:100%;padding:10px 12px;border-radius:10px;text-align:left;color:var(--fg);transition:background .15s}.gpc:hover{background:var(--hover)}.gpc.end{opacity:.65}
.gpc>svg{color:var(--faint);flex-shrink:0}
.gpcp{display:flex;align-items:center;gap:10px;width:min(220px,34%);flex-shrink:0}.gpcp small{width:34px;text-align:right;font-weight:600;color:var(--mute);font-variant-numeric:tabular-nums}
.gempty{color:var(--faint);padding:6px 12px 8px;font-size:12.5px}
.gzero{max-width:420px;margin:12vh auto 0;text-align:center}
.gzero h3{margin:0 0 6px;font-size:20px;font-weight:600;letter-spacing:-.02em}.gzero p{margin:0 0 18px;color:var(--mute)}
.gzb{display:flex;gap:8px;justify-content:center}

@media(max-width:700px){.cvs{grid-template-columns:repeat(2,1fr)}.ct{min-height:56px;padding:7px 8px}.ct b{font-size:15px}.cva{margin-left:0}.gpgs{gap:18px;flex-wrap:wrap}.gpcp{width:96px}}

/* ============ v5 ============ */
.cvs{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}
.cvj{display:flex;flex-direction:column;gap:6px;margin:0 0 16px}.cvj label{font-size:12px;font-weight:600;color:var(--mute)}.cvj textarea{height:64px}
.ct.hasn::before{content:"";position:absolute;right:10px;bottom:11px;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.7}
.gsearch{width:190px;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--soft);color:var(--fg);font:inherit}
.gsearch:focus{outline:0;border-color:var(--ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 22%,transparent)}
.gdue{margin-bottom:14px}.dues{display:flex;flex-wrap:wrap;gap:8px;padding:4px 12px 10px}
.due{display:inline-flex;align-items:center;gap:9px;height:36px;padding:0 14px 0 10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);font-weight:500;cursor:pointer;transition:border-color .15s}.due:hover{border-color:var(--faint)}
.due small{color:var(--mute);font-size:11.5px}.due.done{opacity:.6}.due.done{text-decoration:line-through}
.heat{display:grid;grid-template-columns:repeat(26,1fr);grid-template-rows:repeat(7,auto);grid-auto-flow:column;gap:3px;width:min(100%,520px);padding:4px 12px 14px}
.heat i{aspect-ratio:1;border-radius:3px;background:var(--cellbg);min-width:0}
.cloud-account{display:flex;align-items:center;gap:8px;min-width:0;margin-left:4px;padding-left:10px;border-left:1px solid var(--line)}
.cloud-sync{color:var(--mute);font-size:11px;white-space:nowrap}
.cloud-sync::before{content:"";display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#34c78a;vertical-align:1px}
.cloud-sync.failed{color:#f87171}.cloud-sync.failed::before{background:#f87171}
.cloud-email{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mute);font-size:11px}
.cloud-signout{height:30px;padding:0 9px;font-size:11px}
.cloud-alert{display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 14px;background:#572b32;color:#ffd9dd;font-size:12px;overflow-wrap:anywhere}
.cloud-alert button{flex-shrink:0;border:1px solid #a85863;border-radius:6px;padding:4px 8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
@media(max-width:1100px){.cloud-email{display:none}}
@media(max-width:760px){.cloud-sync{display:none}.cloud-account{gap:4px;padding-left:5px}.cloud-signout{padding:0 6px}}
`;
