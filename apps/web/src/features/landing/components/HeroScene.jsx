import { useRef } from 'react';
import { Bell, CalendarCheck, CircleCheck, LayoutDashboard } from 'lucide-react';
import { usePointerTilt } from '../useLandingMotion.js';
import { BookStack, EduTrackMark, GraduationCap, SchoolBuilding } from './LandingArt.jsx';

const BARS = [42, 58, 50, 72, 64, 80, 55, 88, 70, 92, 76, 84];

/**
 * The hero illustration: a laptop in CSS 3D showing an EduTrack-style dashboard (an illustration, with
 * sample figures), a floating graduation cap, books, the school, and a glowing gold platform. It tilts
 * gently with the pointer and floats; decorative for screen readers.
 */
export function HeroScene() {
  const ref = useRef(null);
  usePointerTilt(ref, 6);
  return (
    <div ref={ref} className="lp-scene" aria-hidden="true">
      <div className="lp-scene__tilt">
        <span className="lp-glow lp-scene__glow-blue" />
        <span className="lp-glow lp-scene__glow-gold" />
        <div className="lp-art lp-art--school">
          <SchoolBuilding />
        </div>
        <div className="lp-platform">
          <span className="lp-platform__edge" />
          <span className="lp-platform__disc" />
          <span className="lp-platform__ring" />
        </div>
        <div className="lp-art lp-art--books">
          <BookStack />
        </div>
        <div className="lp-laptop">
          <div className="lp-laptop__lid">
            <div className="lp-laptop__screen">
              <MiniDashboard />
            </div>
          </div>
          <div className="lp-laptop__base">
            <span />
          </div>
        </div>
        <div className="lp-art lp-art--cap">
          <GraduationCap />
        </div>
        <div className="lp-chip lp-chip--a">
          <CircleCheck />
          <span>
            <b>Attendance</b> taken
          </span>
        </div>
        <div className="lp-chip lp-chip--b">
          <CalendarCheck />
          <span>
            <b>Mid-Term</b> scheduled
          </span>
        </div>
      </div>
    </div>
  );
}

/** The dashboard drawn on the laptop screen: sidebar, KPI tiles, attendance bars, fee donut. */
function MiniDashboard() {
  return (
    <div className="lp-dash">
      <div className="lp-dash__side">
        <div className="lp-dash__brand">
          <EduTrackMark />
          <span>EduTrack</span>
        </div>
        <div className="lp-dash__nav">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ width: `${[100, 82, 74, 88, 70, 80, 64][i]}%` }} />
          ))}
        </div>
      </div>
      <div className="lp-dash__main">
        <div className="lp-dash__top">
          <span className="lp-dash__title">
            <LayoutDashboard style={{ width: '1em', height: '1em', marginRight: '0.4em', verticalAlign: '-0.1em' }} />
            Dashboard
          </span>
          <span className="lp-dash__user">
            <Bell />
            <span className="lp-dash__avatar" />
          </span>
        </div>
        <div className="lp-dash__kpis">
          <div className="lp-kpi lp-kpi--blue">
            <b>1,248</b>
            <small>Students</small>
          </div>
          <div className="lp-kpi lp-kpi--purple">
            <b>86</b>
            <small>Staff</small>
          </div>
          <div className="lp-kpi lp-kpi--teal">
            <b>24</b>
            <small>Classes</small>
          </div>
          <div className="lp-kpi lp-kpi--gold">
            <b>$12,560</b>
            <small>Fees (month)</small>
          </div>
        </div>
        <div className="lp-dash__panels">
          <div className="lp-dash__panel">
            <header>
              <span>Student Attendance</span>
              <em>92%</em>
            </header>
            <div className="lp-bars">
              {BARS.map((h, i) => (
                <span key={i} style={{ height: `${h}%`, animationDelay: `${0.6 + i * 0.06}s` }} />
              ))}
            </div>
          </div>
          <div className="lp-dash__panel">
            <header>
              <span>Fee Collection</span>
            </header>
            <div className="lp-donut">
              <svg viewBox="0 0 42 42">
                <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="5" />
                <circle cx="21" cy="21" r="15.9" fill="none" stroke="#22d3a0" strokeWidth="5" strokeDasharray="78 22" strokeDashoffset="25" strokeLinecap="round" />
                <circle cx="21" cy="21" r="15.9" fill="none" stroke="#f5b82e" strokeWidth="5" strokeDasharray="10 90" strokeDashoffset="47" strokeLinecap="round" />
                <text x="21" y="23.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">
                  78%
                </text>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
