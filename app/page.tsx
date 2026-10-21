"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, LockKeyhole, MapPin, Plus, RotateCcw, Shuffle, SlidersHorizontal, X } from "lucide-react";
import type { Showtime, TheatreOption } from "@/lib/types";

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const idFor = (show: Showtime) => show.movieId ?? show.movieTitle.toLowerCase();
const timeFor = (show: Showtime) => show.listedStartUtc ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: show.theatreTimeZone ?? undefined }).format(new Date(show.listedStartUtc)) : "TBA";
const startsAt = (show: Showtime) => show.listedStartUtc ? Date.parse(show.listedStartUtc) : Infinity;
const runtimeFor = (minutes: number | null) => minutes ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : "Runtime TBA";
const A_LIST_LIMIT = 4;
type Objective = "gaps" | "early" | "late";
type Route = { mask: number; shows: Showtime[]; gap: number };

function theatreMinute(show: Showtime) {
  if (!show.listedStartUtc) return -1;
  const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: show.theatreTimeZone ?? undefined }).formatToParts(new Date(show.listedStartUtc));
  const hour = Number(parts.find((part) => part.type === "hour")?.value); const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
}
function timeValue(value: string) { const [hour, minute] = value.split(":").map(Number); return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1; }
function isBlocked(show: Showtime, start: string, end: string) {
  const from = timeValue(start); const until = timeValue(end); if (from < 0 || until < 0 || from === until) return false;
  const begins = theatreMinute(show); if (begins < 0) return false;
  const finishes = begins + (show.runtimeMinutes ?? 110) + 30;
  return from < until ? begins < until && finishes > from : begins < until || finishes > from;
}
function isPreferred(candidate: Route, current: Route, objective: Objective) {
  const candidateStart = startsAt(candidate.shows[0]); const currentStart = startsAt(current.shows[0]);
  const candidateEnd = startsAt(candidate.shows.at(-1)!) + ((candidate.shows.at(-1)?.runtimeMinutes ?? 110) + 30) * 60000;
  const currentEnd = startsAt(current.shows.at(-1)!) + ((current.shows.at(-1)?.runtimeMinutes ?? 110) + 30) * 60000;
  if (objective === "early") return candidateStart < currentStart || (candidateStart === currentStart && candidate.gap < current.gap);
  if (objective === "late") return candidateEnd > currentEnd || (candidateEnd === currentEnd && candidate.gap < current.gap);
  return candidate.gap < current.gap || (candidate.gap === current.gap && candidateStart < currentStart);
}

function randomIndex(length: number) {
  return Math.floor(Math.random() * length);
}

export default function Home() {
  const [zip, setZip] = useState(""); const [date, setDate] = useState(today); const [theatres, setTheatres] = useState<TheatreOption[]>([]);
  const [theatre, setTheatre] = useState<TheatreOption | null>(null); const [shows, setShows] = useState<Showtime[]>([]); const [chosen, setChosen] = useState<Showtime[]>([]); const [wanted, setWanted] = useState<Set<string>>(new Set()); const [locked, setLocked] = useState<Set<string>>(new Set());
  const [unavailablePicks, setUnavailablePicks] = useState<Showtime[]>([]);
  const [pendingTheatreId, setPendingTheatreId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false); const [objective, setObjective] = useState<Objective>("gaps"); const [blockStart, setBlockStart] = useState(""); const [blockEnd, setBlockEnd] = useState("");
  const films = useMemo(() => [...new Map(shows.map((show) => [idFor(show), show])).values()], [shows]);

  async function search(event: FormEvent) {
    event.preventDefault(); if (!/^\d{5}$/.test(zip)) { setMessage("Enter a five digit ZIP code."); return; }
    setBusy(true); setMessage(""); setTheatre(null); setShows([]); setChosen([]); setWanted(new Set()); setLocked(new Set()); setUnavailablePicks([]); setPendingTheatreId(null);
    try { const response = await fetch(`/api/showtimes?zip=${zip}&date=${date}&mode=theatres`); const data = await response.json(); if (!response.ok) throw new Error(data.message); setTheatres(data.theatres); if (!data.theatres.length) setMessage("No AMC theatres found for that date."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to load theatres."); } finally { setBusy(false); }
  }
  async function selectTheatre(next: TheatreOption) {
    setPendingTheatreId(next.id); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/showtimes?zip=${zip}&date=${date}&theatreId=${next.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      const nextShows: Showtime[] = data.results;
      const nextMovieKeys = new Set(nextShows.map(idFor));
      const previousMovies = new Map(
        [...unavailablePicks, ...films].map((film) => [idFor(film), film]),
      );
      setUnavailablePicks(
        [...previousMovies]
          .filter(([key]) => wanted.has(key) && !nextMovieKeys.has(key))
          .map(([, film]) => film),
      );
      setTheatre(next);
      setShows(nextShows);
      setChosen(scheduleFor(wanted, objective, nextShows));
    }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to load showtimes."); } finally { setPendingTheatreId(null); setBusy(false); }
  }
  function choose(show: Showtime) {
    if (chosen.some((entry) => entry.id === show.id)) {
      setWanted((current) => { const next = new Set(current); next.delete(idFor(show)); return next; });
      setLocked((current) => { const next = new Set(current); next.delete(idFor(show)); return next; });
      setChosen((current) => current.filter((entry) => idFor(entry) !== idFor(show)));
      return;
    }
    setWanted((current) => new Set(current).add(idFor(show)));
    setChosen((current) => [...current.filter((entry) => idFor(entry) !== idFor(show)), show].sort((a, b) => startsAt(a) - startsAt(b)));
  }
  function scheduleFor(wanted: Set<string>, goal = objective, availableShows = shows) {
    const titles = [...wanted].slice(0, A_LIST_LIMIT);
    const bits = new Map(titles.map((title, index) => [title, 1 << index]));
    const options = availableShows.filter((show) => bits.has(idFor(show)) && Number.isFinite(startsAt(show)) && !isBlocked(show, blockStart, blockEnd)).sort((a, b) => startsAt(a) - startsAt(b));
    const endings: Map<number, Route>[] = [];
    for (let index = 0; index < options.length; index += 1) {
      const current = options[index]; const bit = bits.get(idFor(current)); const routes = new Map<number, Route>();
      if (bit === undefined) continue;
      routes.set(bit, { mask: bit, shows: [current], gap: 0 });
      for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
        const previous = options[previousIndex];
        const previousEnd = startsAt(previous) + ((previous.runtimeMinutes ?? 110) + 30) * 60000;
        if (startsAt(current) < previousEnd) continue;
        for (const route of endings[previousIndex]?.values() ?? []) {
          if (route.mask & bit) continue;
          const next: Route = { mask: route.mask | bit, shows: [...route.shows, current], gap: route.gap + startsAt(current) - previousEnd };
          const existing = routes.get(next.mask);
          if (!existing || isPreferred(next, existing, goal)) routes.set(next.mask, next);
        }
      }
      endings[index] = routes;
    }
    let best: Route | null = null;
    for (const routes of endings) for (const route of routes?.values() ?? []) {
      const count = route.shows.length; const bestCount = best?.shows.length ?? 0;
      if (!best || count > bestCount || (count === bestCount && isPreferred(route, best, goal))) best = route;
    }
    return best?.shows ?? [];
  }
  function buildBest() { setChosen(scheduleFor(wanted)); }
  function addFilm(film: Showtime) {
    const next = new Set(wanted);
    if (next.has(idFor(film))) { next.delete(idFor(film)); setLocked((current) => { const locks = new Set(current); locks.delete(idFor(film)); return locks; }); }
    else if (next.size >= A_LIST_LIMIT) { setMessage(`Your A-List rack is full at ${A_LIST_LIMIT} movies.`); return; }
    else next.add(idFor(film));
    setWanted(next); setChosen(scheduleFor(next));
  }
  function surprise() {
    const eligible = films.filter((film) => shows.some((show) => idFor(show) === idFor(film) && !isBlocked(show, blockStart, blockEnd)) && !locked.has(idFor(film)));
    const next = new Set(locked);
    while (next.size < A_LIST_LIMIT && eligible.length) { const index = randomIndex(eligible.length); next.add(idFor(eligible[index])); eligible.splice(index, 1); }
    if (next.size === locked.size && !eligible.length) { setMessage("No eligible movies are available outside your blocked time."); return; }
    setWanted(next); setChosen(scheduleFor(next));
  }
  function toggleLock(show: Showtime) { const movie = idFor(show); setLocked((current) => { const next = new Set(current); if (next.has(movie)) next.delete(movie); else next.add(movie); return next; }); }
  function removeUnavailablePick(movie: Showtime) {
    const key = idFor(movie);
    setWanted((current) => new Set([...current].filter((item) => item !== key)));
    setLocked((current) => new Set([...current].filter((item) => item !== key)));
    setUnavailablePicks((current) => current.filter((item) => idFor(item) !== key));
  }
  const excluded = films.filter((film) => wanted.has(idFor(film)) && !chosen.some((show) => idFor(show) === idFor(film)));
  const exclusionReason = (film: Showtime) => shows.some((show) => idFor(show) === idFor(film) && !isBlocked(show, blockStart, blockEnd)) ? "Does not fit with the rest of this run." : "Every screening conflicts with your blocked time.";

  return <main className="min-h-screen bg-[#090909] text-[#f4f1ed]">
    <div className={`mx-auto max-w-[1600px] px-4 py-4 sm:px-7 sm:py-7 ${chosen.length > 0 ? "pb-24 sm:pb-7" : ""}`}>
      <form onSubmit={search} className="grid border border-[#302b29] bg-[#111] md:grid-cols-[1fr_1fr_auto]">
        <label className="flex min-h-16 items-center gap-3 border-b border-[#302b29] px-4 md:border-r md:border-b-0"><MapPin size={18} className="text-[#e31837]" /><input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="ZIP code" inputMode="numeric" className="w-full bg-transparent text-sm outline-none placeholder:text-[#7d7670]" /></label>
        <div className="border-b border-[#302b29] md:border-r md:border-b-0"><DatePicker value={date} onChange={setDate} /></div>
        <button disabled={busy} className="min-h-16 bg-[#e31837] px-8 text-xs font-bold uppercase tracking-[.16em] transition hover:bg-[#ca1430] disabled:opacity-50">{busy ? "Loading" : "Find a theatre"}</button>
      </form>
      {message && <p role="alert" aria-live="assertive" className="mt-3 border border-[#6c2632] bg-[#211215] px-4 py-3 text-sm text-[#f5bdc6]">{message}</p>}
      {theatres.length > 0 && <div className="mt-5 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2">{theatres.map((item) => <button key={item.id} disabled={busy} onClick={() => selectTheatre(item)} className={`min-w-64 shrink-0 snap-start border px-4 py-4 text-left transition disabled:cursor-wait disabled:opacity-60 ${pendingTheatreId === item.id || (!pendingTheatreId && theatre?.id === item.id) ? "border-[#e31837] bg-[#2a1116]" : "border-[#302b29] bg-[#111] hover:border-[#736a63]"}`}><span className="block truncate text-sm font-bold">{item.name}</span><span className="mt-1 block truncate text-xs text-[#99918a]">{[item.address, item.city, item.state].filter(Boolean).join(", ")}</span></button>)}</div>}
      {pendingTheatreId && <p role="status" className="mt-3 border-l-2 border-[#e31837] pl-3 text-xs leading-5 text-[#aaa29a]">Loading {theatres.find((item) => item.id === pendingTheatreId)?.name}. Your current plan will stay in place until the new showtimes are ready.</p>}
      {busy && !theatre && <div className="grid min-h-[55vh] place-items-center"><span className="size-8 animate-spin rounded-full border-2 border-[#e31837] border-t-transparent" /></div>}
      {!busy && theatre && <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
        <section className="min-w-0">
          {unavailablePicks.length > 0 && <div className="mb-4 border border-[#6c2632] bg-[#211215] p-4" role="status">
            <p className="text-xs leading-5 text-[#f5bdc6]">Some movies from your rack aren’t showing at {theatre.name} and were left out of this plan.</p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {unavailablePicks.map((film) => <li key={idFor(film)} className="flex items-center gap-2 text-xs">
                <span>{film.movieTitle}</span>
                <button type="button" onClick={() => removeUnavailablePick(film)} className="text-[#f5bdc6] underline underline-offset-2 hover:text-white">Remove</button>
              </li>)}
            </ul>
          </div>}
          <div className="grid grid-cols-1 gap-px bg-[#302b29] min-[420px]:grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4">{films.map((film) => { const selectedShow = chosen.find((show) => idFor(show) === idFor(film)); const selectedFilm = wanted.has(idFor(film)); const showings = shows.filter((show) => idFor(show) === idFor(film)); return <article key={idFor(film)} onClick={() => addFilm(film)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); addFilm(film); } }} role="button" tabIndex={0} aria-pressed={selectedFilm} className={`relative min-h-[320px] cursor-pointer overflow-hidden bg-[#111] p-3 outline-none transition hover:z-10 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#e31837] min-[420px]:min-h-[280px] sm:min-h-[300px] sm:p-4 xl:min-h-[380px] ${selectedFilm ? "ring-1 ring-inset ring-[#e31837]" : ""}`}>
          {film.posterUrl && <Image src={film.posterUrl} alt="" fill unoptimized sizes="25vw" className="object-cover opacity-55" />}<div className="absolute inset-0 bg-gradient-to-t from-[#090909] via-[#090909]/35 to-transparent" />
          <div className="relative flex h-full flex-col items-start"><span className="bg-[#151414]/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[#e8e2da]">{runtimeFor(film.runtimeMinutes)}</span><div className="mt-auto"><h2 className="text-xl font-bold leading-[1.02] tracking-[-.04em]">{film.movieTitle}</h2><div className="mt-4 flex flex-wrap gap-1.5">{showings.map((show) => <button key={show.id} onClick={(event) => { event.stopPropagation(); choose(show); }} className={`border px-2.5 py-2 text-[11px] font-bold transition ${selectedShow?.id === show.id ? "border-[#e31837] bg-[#e31837] text-white" : "border-white/30 bg-black/55 hover:border-white"}`}>{timeFor(show)}</button>)}</div></div></div>
        </article>; })}</div></section>
        <aside id="tonight" className="h-fit min-w-0 scroll-mt-4 border border-[#302b29] bg-[#111] p-4 sm:p-5 xl:sticky xl:top-5"><div className="flex items-center justify-between border-b border-[#302b29] pb-4"><span className="text-xs font-bold uppercase tracking-[.16em] text-[#e31837]">Tonight</span><span className="flex items-center gap-2"><button onClick={() => setOptionsOpen((open) => !open)} aria-expanded={optionsOpen} aria-label="Schedule options" className={`grid size-8 place-items-center border ${optionsOpen ? "border-[#e31837] text-[#e31837]" : "border-transparent text-[#aaa29a] hover:text-white"}`}><SlidersHorizontal size={16} /></button><button onClick={() => { setChosen([]); setWanted(new Set()); setLocked(new Set()); }} disabled={!chosen.length} aria-label="Clear schedule" className="text-[#aaa29a] hover:text-white disabled:opacity-30"><RotateCcw size={16} /></button></span></div>
          {optionsOpen && <div className="border-b border-[#302b29] py-4"><div className="grid gap-2"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#837b74]">Optimize for</span><div className="grid grid-cols-3 gap-1">{([['gaps', 'Tight gaps'], ['early', 'Earlier'], ['late', 'Later']] as const).map(([value, label]) => <button key={value} onClick={() => { setObjective(value); setChosen(scheduleFor(wanted, value)); }} className={`border px-2 py-2 text-[10px] font-bold ${objective === value ? "border-[#e31837] bg-[#2a1116] text-white" : "border-[#39332f] text-[#aaa29a] hover:text-white"}`}>{label}</button>)}</div></div><div className="mt-4 grid grid-cols-2 gap-2"><label className="text-[10px] font-bold uppercase tracking-[.13em] text-[#837b74]">Busy from<input type="time" value={blockStart} onChange={(event) => { setBlockStart(event.target.value); }} onBlur={() => setChosen(scheduleFor(wanted))} className="mt-1 block h-9 w-full border border-[#39332f] bg-[#181716] px-2 text-xs text-white [color-scheme:dark]" /></label><label className="text-[10px] font-bold uppercase tracking-[.13em] text-[#837b74]">Until<input type="time" value={blockEnd} onChange={(event) => { setBlockEnd(event.target.value); }} onBlur={() => setChosen(scheduleFor(wanted))} className="mt-1 block h-9 w-full border border-[#39332f] bg-[#181716] px-2 text-xs text-white [color-scheme:dark]" /></label></div><button onClick={surprise} className="mt-4 flex w-full items-center justify-center gap-2 border border-[#39332f] py-2.5 text-[10px] font-bold uppercase tracking-[.13em] text-[#ddd6ce] hover:border-[#e31837]"><Shuffle size={14} /> Add a random movie</button></div>}
          {chosen.length === 0 ? <div className="grid min-h-64 place-items-center text-center"><div><Plus className="mx-auto text-[#e31837]" /><p className="mt-3 text-sm text-[#99918a]">Choose up to {A_LIST_LIMIT} movies to start your run.</p></div></div> : <><ol className="divide-y divide-[#302b29]">{chosen.map((show, index) => <li key={show.id}><div className="flex gap-4 py-5"><button onClick={() => toggleLock(show)} aria-pressed={locked.has(idFor(show))} aria-label={`${locked.has(idFor(show)) ? "Unlock" : "Lock"} ${show.movieTitle}`} className={`grid size-6 shrink-0 place-items-center text-xs font-bold ${locked.has(idFor(show)) ? "bg-[#e31837] text-white" : "text-[#e31837] hover:bg-[#2a1116]"}`}>{locked.has(idFor(show)) ? <LockKeyhole size={12} /> : String(index + 1).padStart(2, "0")}</button><span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-tight">{show.movieTitle}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-[#aaa29a]"><Clock size={12} />{timeFor(show)} / {runtimeFor(show.runtimeMinutes)}</span></span><button onClick={() => choose(show)} aria-label={`Remove ${show.movieTitle}`} className="text-[#aaa29a] hover:text-white"><X size={15} /></button></div>{chosen[index + 1] && <p className="ml-10 -mt-2 pb-4 text-[10px] font-bold uppercase tracking-[.12em] text-[#d6a59e]">{Math.max(0, Math.round((startsAt(chosen[index + 1]) - startsAt(show) - ((show.runtimeMinutes ?? 110) + 30) * 60000) / 60000))} min between screenings</p>}</li>)}</ol>{excluded.length > 0 && <div className="border-t border-[#302b29] pt-4">{excluded.map((film) => <p key={idFor(film)} className="mb-2 text-xs text-[#d9a29b]"><span className="font-bold text-[#f1ddd9]">{film.movieTitle}</span> / {exclusionReason(film)}</p>)}</div>}<button onClick={buildBest} className="mt-5 w-full border border-[#e31837] py-3 text-xs font-bold uppercase tracking-[.14em] text-[#fff] transition hover:bg-[#e31837]">Optimize showtimes</button><p className="mt-3 text-center text-[10px] leading-4 text-[#837b74]">Click a number to lock it, then randomize the rest.</p></>}
        </aside>
      </div>}
      {theatre && chosen.length > 0 && <a href="#tonight" aria-label={`View tonight's plan: ${chosen.length} ${chosen.length === 1 ? "movie" : "movies"}`} className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 border border-[#6c2632] bg-[#171313]/95 px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,.65)] backdrop-blur xl:hidden">
        <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-[.14em] text-[#e31837]">Tonight · {chosen.length} {chosen.length === 1 ? "movie" : "movies"}</span><span className="mt-1 block truncate text-xs text-[#eee8e2]">{chosen.map((show) => show.movieTitle).join(" · ")}</span></span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[.12em]">View plan</span>
      </a>}
    </div>
  </main>;
}

function DatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(`${value}T12:00:00`));
  const active = new Date(`${value}T12:00:00`);
  const minimum = new Date(); minimum.setHours(0, 0, 0, 0);
  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay(); const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, index) => index - first + 1);
  const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(cursor);
  function pick(day: number) { const next = new Date(year, month, day); if (next < minimum) return; onChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`); setOpen(false); }
  const canGoBack = year > minimum.getFullYear() || (year === minimum.getFullYear() && month > minimum.getMonth());
  return <div className="relative"><button type="button" onClick={() => setOpen((state) => !state)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left"><CalendarDays size={18} className="text-[#e31837]" /><span className="text-sm">{fmt.format(active)}</span></button>{open && <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-[318px] border border-[#493f3b] bg-[#141313] p-4 shadow-[0_20px_60px_rgba(0,0,0,.6)]"><div className="mb-4 flex items-center justify-between"><button type="button" disabled={!canGoBack} onClick={() => setCursor(new Date(year, month - 1, 1))} className="grid size-8 place-items-center text-[#c7bfb8] hover:text-white disabled:opacity-20" aria-label="Previous month"><ChevronLeft size={18} /></button><span className="text-xs font-bold uppercase tracking-[.14em]">{label}</span><button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))} className="grid size-8 place-items-center text-[#c7bfb8] hover:text-white" aria-label="Next month"><ChevronRight size={18} /></button></div><div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-[.08em] text-[#756d66]">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`} className="py-2">{day}</span>)}</div><div className="grid grid-cols-7">{cells.map((day, index) => { const cellDate = new Date(year, month, day); const unavailable = day <= 0 || day > days || cellDate < minimum; const selected = day > 0 && active.getFullYear() === year && active.getMonth() === month && active.getDate() === day; return <span key={index} className="grid aspect-square place-items-center">{day > 0 && day <= days && <button type="button" disabled={unavailable} onClick={() => pick(day)} className={`grid size-8 place-items-center rounded-full text-xs transition disabled:text-[#514b46] ${selected ? "bg-[#e31837] font-bold text-white" : "hover:bg-[#312c29]"}`}>{day}</button>}</span>; })}</div></div>}</div>;
}
