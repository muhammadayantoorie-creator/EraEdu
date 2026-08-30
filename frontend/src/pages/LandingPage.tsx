import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/shared';
import { useReveal } from '../hooks/useReveal';
import api from '../services/api';
import toast from 'react-hot-toast';

/* ──────────────────────────────────────────────────────────────────────────
   Vibe: Ethereal Glass · Layout: Asymmetrical Bento + Editorial Split
   ────────────────────────────────────────────────────────────────────────── */

/* ───── Ultra-thin line icons (custom — no Lucide / Heroicons / Material) ───── */
const Stroke = ({
  d,
  size = 18,
  className = '',
}: {
  d: string;
  size?: number;
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const Arrow = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <Stroke d="M5 19 19 5 M9 5h10v10" size={size} className={className} />
);

/* An illustrative scan frame makes the proctoring story understandable without
   implying that a real student's face or camera footage is being shown. */
const FaceScanArtwork = ({ dark = false }: { dark?: boolean }) => (
  <div
    aria-hidden="true"
    className={`relative aspect-[1.42] w-full overflow-hidden rounded-[1.5rem] ring-1 ${
      dark
        ? 'bg-gradient-to-br from-emerald-400/20 via-teal-500/10 to-slate-950/30 ring-white/15'
        : 'bg-gradient-to-br from-emerald-50 via-white to-cyan-50 ring-emerald-900/10 shadow-[0_20px_45px_-32px_rgba(4,120,87,0.55)]'
    }`}
  >
    <div className={`absolute inset-0 opacity-50 ${dark ? 'bg-[radial-gradient(circle_at_50%_30%,rgba(45,212,191,.32),transparent_38%)]' : 'bg-[radial-gradient(circle_at_50%_30%,rgba(52,211,153,.25),transparent_38%)]'}`} />
    <div className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.14em] ${dark ? 'bg-emerald-300/10 text-emerald-100 ring-1 ring-emerald-200/20' : 'bg-white/80 text-emerald-700 ring-1 ring-emerald-200'}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.9)]" />
      FACE VERIFIED
    </div>
    <span className={`absolute right-3 top-3 font-mono text-[8px] tracking-[0.16em] ${dark ? 'text-white/45' : 'text-emerald-800/45'}`}>ON-DEVICE</span>

    <div className="absolute inset-x-0 bottom-0 top-8 flex items-end justify-center">
      <svg viewBox="0 0 220 160" className="h-[94%] w-[94%]" fill="none">
        <path d="M42 152c7-38 30-56 68-56s61 18 68 56" fill={dark ? 'rgba(45,212,191,.28)' : 'rgba(16,185,129,.20)'} />
        <ellipse cx="110" cy="70" rx="34" ry="42" fill={dark ? 'rgba(153,246,228,.55)' : 'rgba(209,250,229,.9)'} />
        <path d="M89 67c5 4 11 4 16 0M116 67c5 4 11 4 16 0M101 88c6 4 12 4 18 0" stroke={dark ? 'rgba(236,253,245,.82)' : 'rgba(4,120,87,.55)'} strokeWidth="2" strokeLinecap="round" />
        <path d="M61 39h18M61 39v18M159 39h-18M159 39v18M61 117h18M61 117V99M159 117h-18M159 117V99" stroke={dark ? 'rgba(110,231,183,.9)' : 'rgba(5,150,105,.75)'} strokeWidth="3" strokeLinecap="round" />
        <rect x="70" y="25" width="80" height="106" rx="35" stroke={dark ? 'rgba(94,234,212,.55)' : 'rgba(16,185,129,.42)'} strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
    </div>
  </div>
);

/* ───── Floating Glass Island Nav (with morphing hamburger) ───── */
const NavIsland = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  const links = [
    { href: '#features', label: 'Features' },
    { href: '#how', label: 'How it works' },
    { href: '#integrity', label: 'AI Integrity' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#trust', label: 'Trust' },
  ];

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-6">
        <div
          className="
            landing-nav flex w-full max-w-6xl items-center gap-2 rounded-full p-1.5
            bg-white/90 backdrop-blur-2xl ring-1 ring-ink-900/5
            shadow-[0_20px_60px_-30px_rgba(5,7,11,0.25)]
          "
        >
          <div className="pl-3 pr-2">
            <Brand to="/" />
          </div>

          <nav aria-label="Primary navigation" className="hidden lg:flex items-center gap-1 px-2">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="
                  whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium text-ink-600
                  transition-all duration-500 ease-spring
                  hover:text-ink-900 hover:bg-ink-900/[0.04]
                "
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/login"
              className="
                hidden sm:inline-flex whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-ink-700
                transition-all duration-500 ease-spring hover:text-ink-900 hover:bg-ink-900/[0.04]
              "
            >
              Sign in
            </Link>
            <Link to="/register" className="btn-island-primary whitespace-nowrap">
              <span className="pr-1">Get started</span>
              <span className="btn-icon bg-white/15">
                <Arrow />
              </span>
            </Link>

            {/* Hamburger → X morph */}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label="Menu"
              aria-expanded={open}
              aria-controls="mobile-navigation"
              className="
                lg:hidden relative ml-1 flex h-10 w-10 items-center justify-center
                rounded-full bg-ink-900/[0.04] ring-1 ring-ink-900/5
              "
            >
              <span
                className={`absolute h-[1.5px] w-4 bg-ink-900 transition-all duration-500 ease-spring ${
                  open ? 'rotate-45 translate-y-0' : '-translate-y-1.5'
                }`}
              />
              <span
                className={`absolute h-[1.5px] w-4 bg-ink-900 transition-all duration-500 ease-spring ${
                  open ? '-rotate-45 translate-y-0' : 'translate-y-1.5'
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile screen-filling glass overlay */}
      <div
        id="mobile-navigation"
        aria-label="Mobile navigation"
        className={`
          fixed inset-0 z-30 md:hidden
          transition-all duration-700 ease-spring
          ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
          backdrop-blur-3xl bg-white/80
        `}
      >
        <div className="flex h-full flex-col justify-center px-8">
          {links.map((l, i) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`
                block py-4 font-display text-5xl tracking-tightest text-ink-900
                transition-all duration-700 ease-spring
                ${open ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-12 opacity-0 blur-md'}
              `}
              style={{ transitionDelay: `${100 + i * 60}ms` }}
            >
              {l.label}
            </a>
          ))}
          <div className="mt-10 flex gap-3">
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="btn-island-ghost"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              onClick={() => setOpen(false)}
              className="btn-island-primary"
            >
              <span className="pr-1">Get started</span>
              <span className="btn-icon bg-white/15">
                <Arrow />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

/* ───── HERO ───── */
const Hero = () => (
  <section className="relative overflow-hidden pt-40 md:pt-48 pb-24 md:pb-32">
    {/* Mesh background */}
    <div
      aria-hidden
      className="absolute inset-0 -z-10 bg-mesh-emerald"
    />
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 -z-10 h-[60vh] bg-grid-faint [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]"
    />
    {/* Floating glow orb */}
    <div
      aria-hidden
      className="absolute left-1/2 top-32 -z-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-primary-300/30 blur-3xl animate-pulse-soft"
    />
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <span className="eyebrow eyebrow-light reveal">
          <span className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />
          Now with AI face-presence proctoring
        </span>

        <h1 className="reveal reveal-delay-1 mt-6 font-display text-[44px] sm:text-6xl md:text-7xl lg:text-[88px] leading-[0.95] tracking-tightest text-balance text-ink-900">
          The integrity engine for{' '}
          <span className="relative inline-block">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, #047857 0%, #10B981 40%, #06B6D4 100%)',
              }}
            >
              modern classrooms
            </span>
            <span className="absolute -bottom-2 left-0 right-0 h-2 bg-gradient-to-r from-transparent via-primary-300/60 to-transparent blur-md" />
          </span>
        </h1>

        <p className="reveal reveal-delay-2 mx-auto mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-ink-500">
          EraEdu secures every assessment with face-presence detection,
          tab-switch sentinels, and copy-paste guards — so educators measure what
          students actually know, not what they could borrow.
        </p>

        <div className="reveal reveal-delay-3 mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link to="/register" className="btn-island-primary">
            <span className="pr-1">Start free trial</span>
            <span className="btn-icon bg-white/15">
              <Arrow />
            </span>
          </Link>
          <a href="#how" className="btn-island-ghost">
            <span className="pr-1">See how it works</span>
            <span className="btn-icon bg-ink-900/[0.06]">
              <Stroke d="M8 5v14l11-7z" size={12} />
            </span>
          </a>
        </div>

        <p className="reveal reveal-delay-4 mt-6 text-xs text-ink-400">
          No credit card · Five free assessment trials · Built for thoughtful educators
        </p>
      </div>

      {/* Hero showcase — Double-bezel display panel */}
      <div className="reveal reveal-delay-5 mt-20">
        <div className="bezel mx-auto max-w-5xl">
          <div className="bezel-core relative overflow-hidden">
            {/* Faux app chrome */}
            <div className="flex items-center gap-2 border-b border-ink-900/5 px-5 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-ink-200" />
              <span className="ml-4 text-[11px] font-medium text-ink-400">
                eraedu.app / live-session / CS-401-Final
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-semibold text-primary-700 ring-1 ring-primary-200">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />
                MONITORING · 24 STUDENTS
              </span>
            </div>

            <div className="grid gap-px bg-ink-900/5 md:grid-cols-[260px_1fr_220px]">
              {/* Sidebar */}
              <div className="bg-white p-5">
                <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">
                  Sections
                </p>
                <ul className="mt-3 space-y-1 text-sm text-ink-700">
                  {['Algorithms', 'Data Structures', 'Complexity', 'Recursion'].map((s, i) => (
                    <li
                      key={s}
                      className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                        i === 0 ? 'bg-ink-900 text-white' : 'hover:bg-ink-50'
                      }`}
                    >
                      <span>{s}</span>
                      <span className={`text-[10px] ${i === 0 ? 'text-white/60' : 'text-ink-400'}`}>
                        {12 - i * 2}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* Main quiz */}
              <div className="bg-white p-6">
                <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">
                  Question 04 / 20
                </p>
                <p className="mt-2 font-display text-2xl tracking-tightest text-ink-900">
                  What is the worst-case time complexity of inserting into a balanced BST?
                </p>
                <div className="mt-5 grid gap-2.5">
                  {['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'].map((opt, i) => (
                    <div
                      key={opt}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm ring-1 transition-all duration-500 ease-spring ${
                        i === 1
                          ? 'bg-primary-50 ring-primary-200 text-primary-800'
                          : 'bg-white ring-ink-900/5 text-ink-700'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                          i === 1 ? 'bg-primary-500 text-white' : 'bg-ink-900/[0.06] text-ink-500'
                        }`}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span>{opt}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Live monitor */}
              <div className="bg-white p-5">
                <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">
                  Live presence
                </p>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={i}
                      className={`aspect-square rounded-lg ring-1 ${
                        i === 5
                          ? 'bg-rose-100 ring-rose-300'
                          : 'bg-primary-50 ring-primary-200'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-4 rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-200">
                  <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-rose-700">
                    Flagged
                  </p>
                  <p className="mt-1 text-xs text-rose-900">
                    Seat 06 — face absent 4.2s
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const AnimatedQuoteBackground = () => {
  const [revealed, setRevealed] = useState(false);
  const words = [
    { value: 'Better', color: '#047857' }, { value: 'learning', color: '#059669' },
    { value: 'begins', color: '#0F766E' }, { value: 'with', color: '#0891B2' },
    { value: 'better', color: '#10B981' }, { value: 'tools.', color: '#0E7490' },
  ];

  useEffect(() => {
    const revealOnScroll = () => { if (window.scrollY > 180) setRevealed(true); };
    revealOnScroll();
    window.addEventListener('scroll', revealOnScroll, { passive: true });
    return () => window.removeEventListener('scroll', revealOnScroll);
  }, []);

  return (
    <div aria-hidden="true" className={`landing-scroll-quote ${revealed ? 'is-revealed' : ''}`}>
      <p className="landing-scroll-quote-line">
        <span className="landing-scroll-quote-mark">“</span>
        {words.map((word, index) => <span key={`${word.value}-${index}`} className="landing-scroll-quote-word" style={{ color: word.color, animationDelay: `${index * 120}ms` }}>{word.value}</span>)}
        <span className="landing-scroll-quote-mark">”</span>
      </p>
    </div>
  );
};

/* ───── SOCIAL PROOF marquee ───── */
/* ───── FEATURE BENTO (Asymmetrical) ───── */
const TrustByDesign = () => {
  const principles = [
    { title: 'Teacher-controlled rules', copy: 'Set quiz availability, assessment rules, and violation limits before a session begins.', icon: 'M5 12h14 M12 5v14' },
    { title: 'Reviewable activity', copy: 'Keep quiz submissions and integrity events together for clear, informed follow-up.', icon: 'M5 12l4 4L19 6 M5 6h14' },
    { title: 'A practical way to start', copy: 'Explore the workflow with five free assessment trials before choosing a paid plan.', icon: 'M12 5v14 M5 12h14' },
  ];
  return (
    <section className="relative border-y border-primary-900/5 bg-white py-8 sm:py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-3 md:gap-0">
          {principles.map((item, index) => (
            <div key={item.title} className={`flex gap-4 px-2 py-3 md:px-8 ${index ? 'md:border-l md:border-primary-900/10' : ''}`}>
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-primary-100"><Stroke d={item.icon} size={18} /></span>
              <div><h2 className="text-sm font-semibold text-primary-950">{item.title}</h2><p className="mt-1 text-sm leading-relaxed text-ink-500">{item.copy}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

type Feat = {
  title: string;
  copy: string;
  span: string;
  visual: React.ReactNode;
  accent?: 'emerald' | 'cyan' | 'violet';
};

const FeatureCard = ({ title, copy, span, visual, accent = 'emerald' }: Feat) => {
  const tag =
    accent === 'cyan'
      ? 'text-accent-700 bg-accent-50 ring-accent-200'
      : accent === 'violet'
      ? 'text-secondary-700 bg-secondary-50 ring-secondary-200'
      : 'text-primary-700 bg-primary-50 ring-primary-200';
  return (
    <div className={`reveal bezel ${span} transition-transform duration-500 ease-spring hover:-translate-y-1`}>
      <div className="bezel-core flex h-full flex-col justify-between gap-6 p-7">
        <div className="relative h-44 overflow-hidden rounded-[1.25rem] bg-ink-50 ring-1 ring-ink-900/5">
          {visual}
        </div>
        <div>
          <span className={`eyebrow ring-1 ${tag}`}>{accent}</span>
          <h3 className="mt-3 font-display text-2xl tracking-tightest text-ink-900">
            {title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">{copy}</p>
        </div>
      </div>
    </div>
  );
};

const FeaturesBento = () => (
  <section id="features" className="relative py-32">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="reveal mx-auto max-w-3xl text-center">
        <span className="eyebrow eyebrow-light">Capabilities</span>
        <h2 className="mt-4 font-display text-4xl md:text-6xl tracking-tightest text-ink-900 text-balance">
          Every layer of integrity, in one platform.
        </h2>
        <p className="mt-5 text-lg text-ink-500 text-pretty">
          From the moment a student joins a session to the final analytics
          breakdown, EraEdu enforces fairness without disrupting flow.
        </p>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-12 md:auto-rows-[minmax(280px,auto)]">
        <FeatureCard
          span="md:col-span-7 md:row-span-2"
          title="AI Face-Presence Proctoring"
          copy="Continuously verifies the student is present, alone, and focused — using an on-device face-detection pipeline. Zero footage uploaded."
          accent="emerald"
          visual={
            <div className="relative flex h-full items-center justify-center p-5 sm:p-7">
              <div className="absolute inset-0 bg-gradient-to-br from-primary-100/70 via-white/20 to-accent-100/50" />
              <div className="relative w-full max-w-[18rem]">
                <FaceScanArtwork />
                <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-white/90 px-3 py-1.5 text-[9px] font-semibold text-emerald-800 shadow-[0_10px_22px_-14px_rgba(4,120,87,.5)] ring-1 ring-emerald-100 backdrop-blur-xl">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  PRIVATE · ON-DEVICE ANALYSIS
                </div>
              </div>
            </div>
          }
        />
        <FeatureCard
          span="md:col-span-5"
          title="Tab-Switch Sentinel"
          copy="Detects every blur, alt-tab, and split-screen attempt. Counts toward a configurable strike system."
          accent="cyan"
          visual={
            <div className="relative flex h-full items-center justify-center bg-ink-900">
              <div className="absolute inset-0 bg-grid-faint [background-size:24px_24px] opacity-30" />
              <div className="relative grid grid-cols-3 gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-10 w-14 rounded-md ring-1 ${
                      i === 4
                        ? 'bg-rose-500/20 ring-rose-400/60'
                        : 'bg-white/5 ring-white/10'
                    }`}
                  />
                ))}
              </div>
            </div>
          }
        />
        <FeatureCard
          span="md:col-span-5"
          title="Copy-Paste Guard"
          copy="Disables copy, paste, right-click, and DevTools shortcuts inside live sessions."
          accent="violet"
          visual={
            <div className="relative flex h-full items-center justify-center">
              <div className="font-mono text-[11px] text-ink-300 select-none">
                <p>Ctrl + C ✗</p>
                <p>Ctrl + V ✗</p>
                <p>Right-click ✗</p>
                <p>DevTools ✗</p>
              </div>
            </div>
          }
        />
        <FeatureCard
          span="md:col-span-4"
          title="Adaptive Question Flow"
          copy="Difficulty self-tunes to each student's signal — keeping the cohort in challenge state."
          accent="emerald"
          visual={
            <div className="relative flex h-full items-end justify-around p-4">
              {[40, 65, 50, 80, 60, 90, 75].map((h, i) => (
                <div
                  key={i}
                  className="w-3 rounded-t-md bg-gradient-to-t from-primary-200 to-primary-500"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          }
        />
        <FeatureCard
          span="md:col-span-4"
          title="Live Cohort Heatmap"
          copy="Educators see attention, accuracy, and risk in a single ambient grid."
          accent="cyan"
          visual={
            <div className="grid h-full grid-cols-6 gap-1 p-3">
              {Array.from({ length: 30 }).map((_, i) => {
                const intensity = (Math.sin(i * 1.7) + 1) / 2;
                return (
                  <div
                    key={i}
                    className="rounded-md"
                    style={{
                      background: `rgba(16,185,129,${0.15 + intensity * 0.7})`,
                    }}
                  />
                );
              })}
            </div>
          }
        />
        <FeatureCard
          span="md:col-span-4"
          title="Forensic Analytics"
          copy="Per-student timelines, violation receipts, and exportable academic reports."
          accent="violet"
          visual={
            <div className="relative h-full p-4">
              <svg viewBox="0 0 200 100" className="h-full w-full">
                <path
                  d="M0 80 C 30 60, 60 30, 90 50 S 150 90, 200 30"
                  fill="none"
                  stroke="#7C3AED"
                  strokeWidth="1.5"
                />
                <path
                  d="M0 80 C 30 60, 60 30, 90 50 S 150 90, 200 30 L 200 100 L 0 100 Z"
                  fill="url(#g1)"
                  opacity="0.3"
                />
                <defs>
                  <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#A78BFA" />
                    <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          }
        />
      </div>
    </div>
  </section>
);

/* ───── HOW IT WORKS — vertical staggered timeline ───── */
const HowItWorks = () => {
  const steps = [
    {
      n: '01',
      t: 'Author a quiz in minutes',
      d: 'Build with rich question types — multiple-choice, code blocks, free response. Versioned, branchable, instantly publishable.',
    },
    {
      n: '02',
      t: 'Distribute via secure code',
      d: 'Students enter a 6-digit join code. We verify identity, request camera permission, and lock the testing window.',
    },
    {
      n: '03',
      t: 'Monitor in real time',
      d: 'A live heatmap surfaces presence anomalies, tab switches, and pace outliers. Intervene with one click.',
    },
    {
      n: '04',
      t: 'Analyze & defend grades',
      d: 'Per-student forensic timelines and exportable reports give you the receipts to defend every score.',
    },
  ];

  return (
    <section id="how" className="relative bg-white py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-5 lg:sticky lg:top-32 self-start">
            <span className="eyebrow eyebrow-light reveal">Workflow</span>
            <h2 className="reveal reveal-delay-1 mt-4 font-display text-4xl md:text-6xl tracking-tightest text-ink-900 text-balance">
              From blank slate to defensible grade.
            </h2>
            <p className="reveal reveal-delay-2 mt-5 text-lg text-ink-500 text-pretty">
              Four deliberate steps — engineered so educators spend more time
              teaching, less time policing.
            </p>
            <Link to="/register" className="reveal reveal-delay-3 mt-8 btn-island-primary">
              <span className="pr-1">Try the workflow</span>
              <span className="btn-icon bg-white/15">
                <Arrow />
              </span>
            </Link>
          </div>

          <div className="relative lg:col-span-7">
            <div className="absolute left-[27px] top-3 bottom-3 w-px bg-gradient-to-b from-transparent via-ink-900/10 to-transparent" />
            <ol className="space-y-6">
              {steps.map((s, i) => (
                <li key={s.n} className={`reveal reveal-delay-${i + 1}`}>
                  <div className="bezel">
                    <div className="bezel-core flex gap-5 p-6">
                      <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-ink-900 text-white font-display text-lg ring-4 ring-white">
                        {s.n}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-display text-2xl tracking-tightest text-ink-900">
                          {s.t}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-ink-500">
                          {s.d}
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ───── PRODUCT WALKTHROUGH ───── */
/* ───── INTEGRITY SPOTLIGHT (dark editorial split) ───── */
const IntegritySpotlight = () => (
  <section
    id="integrity"
    className="relative overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-teal-900 py-32 text-white"
  >
    <div
      aria-hidden
      className="absolute inset-0 -z-10 bg-mesh-emerald opacity-60"
    />
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 -z-10 h-full bg-grid-faint [background-size:48px_48px] opacity-[0.04]"
    />

    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="grid items-center gap-16 lg:grid-cols-2">
        <div>
          <span className="eyebrow eyebrow-dark reveal">AI Integrity</span>
          <h2 className="reveal reveal-delay-1 mt-4 font-display text-4xl md:text-6xl tracking-tightest text-white text-balance">
            Proctoring that respects{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, #6CE8B7 0%, #22D3EE 100%)',
              }}
            >
              students.
            </span>
          </h2>
          <p className="reveal reveal-delay-2 mt-5 max-w-xl text-lg text-white/60 text-pretty">
            All face-presence inference happens on-device using face-api.js.
            We store anomaly events, never video. Reviewable. Explainable.
            Designed with privacy-aware assessment workflows in mind.
          </p>

          <ul className="reveal reveal-delay-3 mt-10 space-y-4">
            {[
              'On-device processing designed to minimise unnecessary data collection',
              'Event-only logs with timestamped rationale',
              'Configurable strike thresholds per quiz',
              'Auditable trail for every flagged moment',
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-white/80">
                <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500/20 ring-1 ring-primary-400/40">
                  <Stroke d="M5 13l4 4L19 7" size={12} className="text-primary-300" />
                </span>
                <span className="text-sm leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Visual — Camera ring + telemetry */}
        <div className="reveal reveal-delay-2 relative">
          <div className="bezel-dark">
            <div className="bezel-core-dark relative aspect-[4/5] overflow-hidden p-8">
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-accent-500/10"
              />

              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-eyebrow text-white/70 ring-1 ring-white/10">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                    REC · 00:14:32
                  </span>
                  <span className="font-mono text-[10px] text-white/40">
                    QS · v4.2
                  </span>
                </div>

                <div className="relative mx-auto my-auto w-full max-w-[19rem] py-7">
                  <FaceScanArtwork dark />
                  <div className="absolute -bottom-1 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-300/10 px-3 py-1 text-[9px] font-semibold tracking-[0.12em] text-emerald-100 ring-1 ring-emerald-200/20 backdrop-blur-xl">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.9)]" />
                    PRESENCE CONFIRMED
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { l: 'Confidence', v: '99.4%' },
                    { l: 'Latency', v: '12ms' },
                    { l: 'Anomalies', v: '0' },
                  ].map((m) => (
                    <div
                      key={m.l}
                      className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10"
                    >
                      <p className="font-display text-xl text-white">{m.v}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-eyebrow text-white/40">
                        {m.l}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ───── METRICS strip ───── */
const Metrics = () => {
  const items = [
    { k: 'Privacy-aware', l: 'Designed for responsible assessment workflows' },
    { k: 'Configurable', l: 'Set rules and violation thresholds per quiz' },
    { k: 'Actionable', l: 'Review clear integrity events and quiz results' },
    { k: 'Launch offer', l: 'Start with five free assessment trials' },
  ];
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((m, i) => (
            <div
              key={m.k}
              className={`reveal reveal-delay-${i + 1} border-l border-ink-900/10 pl-6`}
            >
              <p className="font-display text-3xl tracking-tightest text-primary-800">
                {m.k}
              </p>
              <p className="mt-2 text-sm font-medium text-ink-500">{m.l}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ───── TESTIMONIALS — Z-axis cascade on desktop ───── */
const Pricing = () => {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const plans = [
    { name: 'Explore', price: 'Free', description: 'A confident way to see how EraEdu fits your assessment workflow.', features: ['5 free assessment trials', 'AI integrity monitoring', 'Core quiz analytics', 'No credit card required'], cta: 'Start 5 free trials', to: '/register' },
    { name: 'Institution', price: 'PKR 4,999', suffix: '/ month', description: 'One monthly licence for your whole institution, not per teacher.', features: ['Institution workspace', 'Unlimited assessments', 'Detailed integrity reports', 'Priority support'], cta: 'Pay with Safepay', to: '/profile', featured: true },
    { name: 'Enterprise', price: 'Custom', description: 'A tailored rollout for large departments and academic networks.', features: ['Everything in Institution', 'Flexible permissions', 'Institutional analytics', 'Dedicated onboarding'], cta: 'Talk to sales', to: '/contact' },
  ];
  const startCheckout = async () => {
    setCheckoutLoading(true);
    try { const response = await api.post('/safepay/checkout'); window.location.assign(response.data.data.url); }
    catch (error: any) { toast.error(error.response?.data?.error?.message || 'Please sign in with a teacher account to continue.'); setCheckoutLoading(false); }
  };

  return (
    <section id="pricing" className="relative overflow-hidden bg-white py-32">
      <div aria-hidden className="absolute inset-x-0 top-0 h-80 bg-mesh-emerald opacity-60" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="reveal mx-auto max-w-3xl text-center">
          <span className="eyebrow eyebrow-light">Simple pricing</span>
          <h2 className="mt-4 font-display text-4xl tracking-tightest text-ink-900 text-balance md:text-6xl">Start with five free trials. Scale when you are ready.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-500 text-pretty">Validate every feature with five complimentary assessment trials, then choose the plan that matches your classroom.</p>
        </div>

        <div className="mx-auto mt-16 grid max-w-6xl gap-5 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan, i) => (
            <article key={plan.name} className={`reveal reveal-delay-${i + 1} relative rounded-[2rem] p-1.5 ring-1 transition-transform duration-500 ease-spring hover:-translate-y-1 ${plan.featured ? 'bg-gradient-to-br from-primary-400 via-primary-500 to-accent-400 ring-primary-400/30 shadow-glow-emerald' : 'bg-ink-900/[0.04] ring-ink-900/5'}`}>
              {plan.featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary-800 px-3 py-1 text-[10px] font-semibold uppercase tracking-eyebrow text-white shadow-soft">Most popular</span>}
              <div className="flex h-full flex-col rounded-[calc(2rem-0.375rem)] bg-white p-7 sm:p-8">
                <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-primary-700">{plan.name}</p>
                <div className="mt-5 flex items-end gap-2"><span className="font-display text-5xl tracking-tightest text-ink-900">{plan.price}</span>{plan.suffix && <span className="mb-1 text-sm text-ink-500">{plan.suffix}</span>}</div>
                <p className="mt-4 min-h-[3rem] text-sm leading-relaxed text-ink-500">{plan.description}</p>
                <div className="my-7 h-px bg-ink-900/8" />
                <ul className="space-y-3.5">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-3 text-sm text-ink-700"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700 ring-1 ring-primary-200"><Stroke d="M5 13l4 4L19 7" size={12} /></span>{feature}</li>)}</ul>
                {plan.featured ? <button type="button" onClick={startCheckout} disabled={checkoutLoading} className="btn-island-primary mt-8 w-full justify-between disabled:opacity-60"><span>{checkoutLoading ? 'Opening Safepay…' : 'Pay with Safepay'}</span><span className="btn-icon bg-white/15"><Arrow /></span></button> : <Link to={plan.to} className="btn-island-ghost mt-8 w-full justify-between"><span>{plan.cta}</span><span className="btn-icon bg-ink-900/[0.06]"><Arrow /></span></Link>}
              </div>
            </article>
          ))}
        </div>
        <p className="reveal mt-8 text-center text-sm text-ink-400">PKR 4,999 covers one institution for one month. Renew monthly to continue service.</p>
      </div>
    </section>
  );
};

const Testimonials = () => {
  const principles = [
    {
      q: 'Make assessment expectations clear before students start, then capture the events educators need to review.',
      a: 'Clear by design',
      r: 'Transparent assessment workflows',
    },
    {
      q: 'Give educators practical controls for tab switches, copy-paste behaviour, and automatic submission limits.',
      a: 'Educator control',
      r: 'Configurable safeguards per quiz',
    },
    {
      q: 'Build a defensible assessment record without turning a classroom into a surveillance exercise.',
      a: 'Respectful integrity',
      r: 'Purposeful monitoring and review',
    },
  ];

  return (
    <section id="trust" className="relative bg-ink-50 py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="reveal mx-auto max-w-3xl text-center">
          <span className="eyebrow eyebrow-light">Our approach</span>
          <h2 className="mt-4 font-display text-4xl md:text-6xl tracking-tightest text-ink-900 text-balance">
            Built for fair, reviewable assessments.
          </h2>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {principles.map((qq, i) => (
            <figure
              key={i}
              className={`reveal reveal-delay-${i + 1} bezel transition-transform duration-500 ease-spring hover:-translate-y-1`}
            >
              <blockquote className="bezel-core flex h-full flex-col gap-6 p-7">
                <Stroke
                  d="M9 7H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2H4 M19 7h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v3a2 2 0 0 1-2 2h-1"
                  size={28}
                  className="text-primary-500"
                />
                <p className="font-display text-xl leading-snug tracking-tightest text-ink-900">
                  {qq.q}
                </p>
                <figcaption className="mt-auto flex items-center gap-3 border-t border-ink-900/5 pt-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-accent-400 font-display text-white">
                    {qq.a.split(' ').slice(-1)[0][0]}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{qq.a}</p>
                    <p className="text-xs text-ink-500">{qq.r}</p>
                  </div>
                </figcaption>
              </blockquote>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
};

const FAQ = () => {
  const [openQuestion, setOpenQuestion] = useState<number | null>(0);
  const questions = [
    ['What do the five free trials include?', 'Your institution can create up to five assessments on the free plan. The Institution plan unlocks unlimited assessment creation for its teachers.'],
    ['Is student camera footage stored?', 'EraEdu is designed for on-device face-presence checks. The product records configured integrity events for review, not a video recording of students.'],
    ['Can teachers control monitoring rules?', 'Yes. Teachers configure quiz timing, availability, course access, violation limits, and supported integrity settings while creating a quiz.'],
    ['Who should choose the Institution plan?', 'Choose it when your institution needs a shared workspace, multiple teachers, unlimited assessments, and detailed integrity reporting.'],
    ['How does payment work?', 'The Institution plan is a monthly Safepay checkout. The institution owner can activate the plan from their EraEdu profile.'],
  ];

  return (
    <section id="faq" className="relative bg-white/55 py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="eyebrow eyebrow-light">Questions, answered</span>
          <h2 className="mt-4 font-display text-4xl tracking-tightest text-ink-900 text-balance md:text-6xl">Everything you need before your first quiz.</h2>
          <p className="mt-5 text-lg text-ink-500">Clear expectations for educators, institutions, and students.</p>
        </div>
        <div className="mt-12 space-y-3">
          {questions.map(([question, answer], index) => (
            <div key={question} className={`reveal reveal-delay-${Math.min(index + 1, 5)} rounded-2xl bg-white/80 px-5 ring-1 ring-ink-900/5 transition-all ${openQuestion === index ? 'shadow-[0_16px_35px_-30px_rgba(4,120,87,.5)]' : ''}`}>
              <button
                type="button"
                onClick={() => setOpenQuestion((current) => current === index ? null : index)}
                className="flex w-full items-center justify-between gap-6 py-5 text-left text-sm font-semibold text-ink-900"
                aria-expanded={openQuestion === index}
                aria-controls={`faq-answer-${index}`}
              >
                {question}
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-lg font-normal text-primary-700 transition-transform duration-300 ${openQuestion === index ? 'rotate-45' : ''}`}>+</span>
              </button>
              {openQuestion === index && <p id={`faq-answer-${index}`} className="max-w-3xl pb-5 text-sm leading-relaxed text-ink-500">{answer}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ───── FINAL CTA ───── */
const FinalCTA = () => (
  <section className="relative px-4 py-32">
    <div className="reveal mx-auto max-w-6xl">
      <div className="relative rounded-[2rem] bg-primary-700/30 p-1.5 ring-1 ring-primary-500/40 shadow-glow-emerald">
        <div className="relative overflow-hidden rounded-[calc(2rem-0.375rem)] bg-gradient-to-br from-primary-950 via-primary-900 to-teal-900 px-8 py-24 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] sm:px-16">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-mesh-emerald opacity-80"
          />
          <span className="eyebrow eyebrow-dark">Ready when you are</span>
          <h2 className="mt-5 font-display text-5xl md:text-7xl tracking-tightest text-white text-balance">
            Bring integrity back to{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, #6CE8B7 0%, #22D3EE 100%)',
              }}
            >
              every assessment.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/60 text-pretty">
            Create fairer, faster, and more defensible assessments with EraEdu.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register" className="btn-island-emerald">
              <span className="pr-1">Start free trial</span>
              <span className="btn-icon-dark">
                <Arrow />
              </span>
            </Link>
            <Link to="/contact" className="btn-island-ghost-dark">
              <span className="pr-1">Talk to sales</span>
              <span className="btn-icon">
                <Arrow />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ───── FOOTER ───── */
const Footer = () => (
  <footer className="border-t border-ink-900/5 bg-white">
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Brand to="/" />
          <p className="mt-5 max-w-sm text-sm text-ink-500">
            EraEdu is the learning platform for modern classrooms. Built by
            educators, secured by engineers.
          </p>
        </div>
        {[
          {
            h: 'Platform',
            l: [
              ['Features', '#features'],
              ['Workflow', '#how'],
              ['AI Integrity', '#integrity'],
              ['Pricing', '#pricing'],
              ['Trust', '#trust'],
              ['FAQ', '#faq'],
            ],
          },
          {
            h: 'Account',
            l: [
              ['Sign in', '/login'],
              ['Create account', '/register'],
              ['Profile', '/profile'],
            ],
          },
          {
            h: 'Company',
            l: [
              ['Contact', '/contact'],
              ['Privacy', '/privacy'],
              ['Terms', '/terms'],
            ],
          },
        ].map((col) => (
          <div key={col.h} className="lg:col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">
              {col.h}
            </p>
            <ul className="mt-4 space-y-2.5">
              {col.l.map(([label, href]) => (
                <li key={label}>
                  <Link
                    to={href}
                    className="text-sm text-ink-700 transition-colors duration-300 hover:text-primary-700"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="hairline-x mt-14" />
      <div className="mt-6 flex flex-col items-start justify-between gap-4 text-xs text-ink-400 sm:flex-row sm:items-center">
        <p>© {new Date().getFullYear()} EraEdu. All rights reserved.</p>
        <p className="font-mono">Engineered for academic integrity.</p>
      </div>
    </div>
  </footer>
);

/* ───── PAGE ROOT ───── */
const LandingPage = () => {
  useReveal();

  return (
    <div data-reveal-root className="landing-teal min-h-[100dvh] bg-[#f4fbf8] text-primary-950 grain-fixed">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <AnimatedQuoteBackground />
      <NavIsland />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <TrustByDesign />
        <FeaturesBento />
        <HowItWorks />
        <IntegritySpotlight />
        <Metrics />
        <Pricing />
        <Testimonials />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;
