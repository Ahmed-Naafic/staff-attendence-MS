import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BadgeCheck, CalendarCheck, CalendarDays, ChartColumnIncreasing, ChevronRight, Coins, Crown, FileText, GraduationCap, Menu, Moon, Play, Settings, ShieldCheck, Sun, UserRound, Users, X } from 'lucide-react';
import { useTheme } from '../../app/providers/ThemeProvider.jsx';
import { useBranding } from '../branding';
import { EduTrackMark, BookStack, GraduationCap as CapArt } from './components/LandingArt.jsx';
import { HeroScene } from './components/HeroScene.jsx';
import { ParticleWaves } from './components/ParticleWaves.jsx';
import { PhoneCheckIn } from './components/PhoneCheckIn.jsx';
import { SignInDialog } from './components/SignInDialog.jsx';
import { landingConfig } from './landingConfig.js';
import { useActiveSection, useReveal, useScrolled } from './useLandingMotion.js';
import './landing.css';

/*
 * The public landing page ("/" when signed out). Sections: header, hero, key features (the real EduTrack
 * modules), how EduTrack works (the four roles, the staff check-in app), facts, the call to action and the
 * footer. Sign In opens the sign-in form in a dialog on this page ("/login" opens with it shown); Get
 * Started leads to the call to action, whose button writes to EduTrack (VITE_CONTACT_EMAIL) or opens Sign
 * In when no contact address is configured. The header switches the light and dark theme.
 */

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'get-started', label: 'Pricing' },
  { id: 'about', label: 'About' },
];

const FEATURES = [
  { icon: Users, title: 'Students', text: 'Manage student records and enrollments', accent: '#4aa3ff' },
  { icon: UserRound, title: 'Staff', text: 'Staff profiles, roles and permissions', accent: '#5fb7ff' },
  { icon: CalendarCheck, title: 'Attendance', text: 'Student and staff attendance tracking', accent: '#f5b82e' },
  { icon: FileText, title: 'Examinations', text: 'Create exams, enter marks and results', accent: '#a58bff' },
  { icon: Coins, title: 'Fee Management', text: 'Fees, invoices, payments and reports', accent: '#f5b82e' },
  { icon: CalendarDays, title: 'Timetable', text: 'Class schedules and teaching plans', accent: '#a58bff' },
  { icon: ChartColumnIncreasing, title: 'Reports', text: 'Academic, financial and operational reports', accent: '#2fd98f' },
];

const ROLES = [
  { icon: Crown, title: 'Owner', text: 'Set up the school and overall policies', c1: '#c98a12', c2: '#ffd36b' },
  { icon: Settings, title: 'Manager', text: 'Manage branches, classes and operations', c1: '#1f6fd6', c2: '#5fb0ff' },
  { icon: GraduationCap, title: 'Teacher', text: 'Take attendance, manage classes and enter marks', c1: '#6a4fd8', c2: '#a58bff' },
  { icon: Coins, title: 'Accountant', text: 'Handle fees, payments and cash closing', c1: '#13a06a', c2: '#3ee0a0' },
];

const STAT_ICONS = { schools: Users, students: Users, staff: GraduationCap, uptime: ShieldCheck };
const STAT_ACCENTS = { gold: '#f5b82e', blue: '#4aa3ff', green: '#2fd98f' };

export default function LandingPage({ signIn = false, next = null }) {
  const rootRef = useRef(null);
  const { platformName, loaded } = useBranding();
  const name = loaded && platformName ? platformName : 'EduTrack';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signInOpen, setSignInOpen] = useState(signIn);
  useEffect(() => setSignInOpen(signIn), [signIn]);
  const openSignIn = () => setSignInOpen(true);
  const closeSignIn = () => {
    setSignInOpen(false);
    // Closed on /login (e.g. after a redirect): back to the plain landing page address.
    if (pathname === '/login') navigate('/', { replace: true });
  };
  useReveal(rootRef);

  useEffect(() => {
    document.title = signInOpen ? `Sign in · ${name}` : `${name} · School Management System`;
  }, [name, signInOpen]);

  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = previous;
    };
  }, []);

  return (
    <div ref={rootRef} className="lp">
      <ParticleWaves />
      <Waves />
      <Header name={name} onSignIn={openSignIn} />
      <main id="main-content">
        <Hero />
        <Features />
        <HowItWorks />
        <FinalCta onSignIn={openSignIn} />
      </main>
      <Footer name={name} onSignIn={openSignIn} />
      <SignInDialog open={signInOpen} onClose={closeSignIn} name={name} next={next} />
    </div>
  );
}

function Header({ name, onSignIn }) {
  const scrolled = useScrolled();
  const active = useActiveSection(NAV.map((n) => n.id));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <header className={`lp-header${scrolled || open ? ' is-scrolled' : ''}`}>
      <div className="lp-container lp-header__bar">
        <a href="#home" className="lp-logo" aria-label={`${name} home`}>
          <EduTrackMark className="lp-logo__mark" />
          <span>{name}</span>
        </a>
        <nav className="lp-nav" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.label} href={`#${n.id}`} aria-current={active === n.id ? 'true' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="lp-header__actions">
          <ThemeButton />
          <button type="button" className="lp-btn lp-btn--ghost" onClick={onSignIn}>
            Sign In
          </button>
          <a href="#get-started" className="lp-btn lp-btn--gold">
            Get Started
          </a>
        </div>
        <span className="lp-theme-mobile">
          <ThemeButton />
        </span>
        <button type="button" className="lp-menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="lp-mobile-nav" onClick={() => setOpen((v) => !v)}>
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
      <div id="lp-mobile-nav" className={`lp-mobile-nav${open ? ' is-open' : ''}`} inert={!open}>
        <div>
          <nav className="lp-container" aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.label} href={`#${n.id}`} className="lp-mobile-link" onClick={() => setOpen(false)}>
                {n.label}
              </a>
            ))}
            <div className="lp-mobile-actions">
              <button
                type="button"
                className="lp-btn lp-btn--ghost"
                onClick={() => {
                  setOpen(false);
                  onSignIn();
                }}
              >
                Sign In
              </button>
              <a href="#get-started" className="lp-btn lp-btn--gold" onClick={() => setOpen(false)}>
                Get Started
              </a>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="home" className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-container lp-hero__grid">
        <div>
          <span className="lp-badge" data-reveal style={{ '--d': '0.05s' }}>
            <BadgeCheck aria-hidden="true" />
            School Management System
          </span>
          <h1 id="lp-hero-title" data-reveal style={{ '--d': '0.12s' }}>
            One Platform.
            <br />
            Complete School <span className="lp-gold-text">Management.</span>
          </h1>
          <p className="lp-hero__lead" data-reveal style={{ '--d': '0.2s' }}>
            A modern and integrated system to manage students, staff, attendance, examinations, fees and school operations for schools of any size.
          </p>
          <div className="lp-hero__ctas" data-reveal style={{ '--d': '0.28s' }}>
            <a href="#get-started" className="lp-btn lp-btn--gold lp-btn--lg">
              Get Started Free
              <ChevronRight aria-hidden="true" />
            </a>
            <a href="#how-it-works" className="lp-btn lp-btn--ghost lp-btn--lg">
              <Play aria-hidden="true" />
              See How It Works
            </a>
          </div>
          <ul className="lp-trust" data-reveal style={{ '--d': '0.36s' }}>
            {['All-in-One', 'Secure & Reliable', 'Multi-Branch'].map((t) => (
              <li key={t}>
                <span className="lp-check">
                  <CheckMark />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div data-reveal="zoom" style={{ '--d': '0.15s' }}>
          <HeroScene />
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="lp-section" aria-labelledby="lp-features-title">
      <div className="lp-container">
        <p className="lp-eyebrow" data-reveal>
          Key Features
        </p>
        <h2 id="lp-features-title" className="lp-h2" data-reveal style={{ '--d': '0.05s' }}>
          Powerful Modules for Modern Schools
        </h2>
        <p className="lp-sub" data-reveal style={{ '--d': '0.1s' }}>
          Everything your school needs, in one connected platform.
        </p>
        <ul className="lp-features">
          {FEATURES.map((f, i) => (
            <li key={f.title} className="lp-card lp-feature" data-reveal style={{ '--d': `${0.06 * i}s`, '--accent': f.accent }}>
              <span className="lp-feature__icon">
                <f.icon aria-hidden="true" />
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="lp-section" aria-labelledby="lp-works-title">
      <div className="lp-container lp-works">
        <div data-reveal="left">
          <PhoneCheckIn />
        </div>
        <div>
          <h2 id="lp-works-title" className="lp-h2" data-reveal>
            How EduTrack Works
          </h2>
          <p className="lp-sub" data-reveal style={{ '--d': '0.05s' }}>
            A connected platform for everyone in your school.
          </p>
          <ol className="lp-roles">
            {ROLES.map((r, i) => (
              <li key={r.title} className="lp-role" data-reveal style={{ '--d': `${0.1 * i}s`, '--c1': r.c1, '--c2': r.c2 }}>
                <span className="lp-role__icon">
                  <r.icon aria-hidden="true" />
                </span>
                <div className="lp-card lp-role__card">
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Stats />
        </div>
      </div>
    </section>
  );
}

/** Verified platform figures when configured; otherwise what EduTrack is (no invented numbers). */
function Stats() {
  return (
    <div className="lp-card lp-stats" data-reveal="zoom" style={{ '--d': '0.1s' }}>
      <h3 className="sr-only">{landingConfig.verifiedStats ? 'EduTrack in numbers' : 'EduTrack at a glance'}</h3>
      {landingConfig.stats.map((s) => {
        const Icon = STAT_ICONS[s.icon] ?? Users;
        return (
          <div key={s.key} className="lp-stat" style={{ '--accent': STAT_ACCENTS[s.accent] }}>
            <Icon aria-hidden="true" />
            <div>
              <b data-long={s.value.length > 6 || undefined}>{s.value}</b>
              <span>{s.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FinalCta({ onSignIn }) {
  const contact = landingConfig.contactHref;
  return (
    <section id="get-started" className="lp-section" aria-labelledby="lp-cta-title">
      <div className="lp-container">
        <div className="lp-cta" data-reveal="zoom">
          <div className="lp-cta__art" aria-hidden="true">
            <div className="lp-art lp-art--cta-books">
              <BookStack variant="cta" />
            </div>
            <div className="lp-art lp-art--cta-cap">
              <CapArt />
            </div>
          </div>
          <div>
            <h2 id="lp-cta-title">Ready to Digitize Your School?</h2>
            <p>Join schools that trust EduTrack to simplify management, improve efficiency and drive better learning outcomes.</p>
            {!contact && <p className="lp-cta__note">EduTrack sets up each school&rsquo;s account. Already set up? Sign in with the details you were given.</p>}
          </div>
          {contact ? (
            <a href={contact} className="lp-btn lp-btn--gold lp-btn--lg">
              Get Started Today
              <ChevronRight aria-hidden="true" />
            </a>
          ) : (
            <button type="button" className="lp-btn lp-btn--gold lp-btn--lg" onClick={onSignIn}>
              Get Started Today
              <ChevronRight aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer({ name, onSignIn }) {
  const { contactHref, socials } = landingConfig;
  return (
    <footer id="about" className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer__grid">
          <div className="lp-footer__brand">
            <a href="#home" className="lp-logo">
              <EduTrackMark className="lp-logo__mark" />
              <span>
                {name}
                <small>School Management System</small>
              </span>
            </a>
            <p className="lp-footer__about">
              {name} brings a school&rsquo;s students, staff, attendance, examinations, timetables and fees into one platform, with a web workspace for the office and a mobile app for staff.
            </p>
          </div>
          <div>
            <h3>Product</h3>
            <ul>
              <li><a href="#features">Features</a></li>
              <li><a href="#how-it-works">How It Works</a></li>
              <li><a href="#get-started">Pricing</a></li>
            </ul>
          </div>
          <div>
            <h3>Company</h3>
            <ul>
              <li><a href="#about">About</a></li>
              {contactHref && <li><a href={contactHref}>Contact</a></li>}
              {contactHref && <li><a href={contactHref}>Support</a></li>}
              <li>
                <button type="button" className="lp-link-btn" onClick={onSignIn}>
                  Sign In
                </button>
              </li>
            </ul>
          </div>
          {socials.length > 0 && (
            <ul className="lp-socials" aria-label="EduTrack on social media">
              {socials.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                    <SocialIcon name={s.key} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="lp-copy">
          © {new Date().getFullYear()} {name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/** Switches the light and dark theme (the same setting as in the app). */
function ThemeButton() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="lp-theme-btn" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'dark' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </button>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Small brand marks for configured social accounts (decorative; the link has the name). */
function SocialIcon({ name }) {
  const paths = {
    youtube: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3Z',
    linkedin: 'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3Zm6.5 0h3.8v1.5h.1c.5-.95 1.8-1.95 3.7-1.95 4 0 4.7 2.6 4.7 6v6.45h-4V15.6c0-1.4 0-3.1-1.9-3.1s-2.2 1.5-2.2 3v5.25h-4Z',
    x: 'M17.7 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.9Zm-1.1 16.2h1.7L7.5 4.7H5.7Z',
    facebook: 'M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21Z',
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/** Soft blue waves behind the hero and the lower sections. */
function Waves() {
  return (
    <div className="lp-waves" aria-hidden="true">
      <svg viewBox="0 0 1440 320" style={{ top: '30rem' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-wave-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1a5fc4" stopOpacity="0.5" />
            <stop offset="0.5" stopColor="#0e3a7a" stopOpacity="0.15" />
            <stop offset="1" stopColor="#1a5fc4" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <path d="M0 160 C240 60 480 60 720 150 C960 240 1200 240 1440 120 L1440 320 L0 320 Z" fill="url(#lp-wave-a)" opacity="0.35" />
        <path d="M0 200 C300 120 520 140 760 200 C1000 260 1220 230 1440 170" stroke="#3b8cff" strokeOpacity="0.35" strokeWidth="2" fill="none" />
      </svg>
      <svg viewBox="0 0 1440 320" style={{ top: '62rem' }} preserveAspectRatio="none">
        <path d="M0 120 C260 220 520 220 760 140 C1000 60 1240 80 1440 160" stroke="#3b8cff" strokeOpacity="0.25" strokeWidth="2" fill="none" />
      </svg>
    </div>
  );
}
