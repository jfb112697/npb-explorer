import { useEffect } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PlayerSearch } from './components/PlayerSearch'
import { Segmented } from './components/ui'
import { SettingsProvider, useSettings } from './lib/settings'
import Compare from './pages/Compare'
import Glossary from './pages/Glossary'
import Home from './pages/Home'
import Leaders from './pages/Leaders'
import Player from './pages/Player'
import Teams from './pages/Teams'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

function Shell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { unit, setUnit, theme, setTheme } = useSettings()
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true" />NPB Explorer</Link>
          <nav aria-label="Main">
            <NavLink to="/leaders">Leaderboards</NavLink>
            <NavLink to="/compare">Compare</NavLink>
            <NavLink to="/teams">Teams</NavLink>
            <NavLink to="/glossary">Primer</NavLink>
          </nav>
          {pathname !== '/' && <PlayerSearch compact onPick={(p) => navigate(`/player/${p.id}`)} />}
          <div className="topbar-tools">
            <Segmented label="Velocity unit" value={unit} onChange={setUnit} options={[
              { value: 'mph', label: 'mph', title: 'Show pitch speeds in miles per hour' },
              { value: 'kmh', label: 'km/h', title: 'Show pitch speeds in kilometres per hour, as NPB does' },
            ]} />
            <button type="button" className="theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaders" element={<Leaders />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/glossary" element={<Glossary />} />
          <Route path="*" element={<div className="page"><header className="page-head"><h1>Page not found</h1></header><p className="empty">That address does not match anything here. <Link to="/">Go to the home page</Link>.</p></div>} />
        </Routes>
      </main>
      <footer className="footer">
        <p>
          This uses data sourced from the Nippon Baseball Data Repository, which can be accessed here:{' '}
          <a href="https://github.com/armstjc/Nippon-Baseball-Data-Repository" target="_blank" rel="noreferrer">https://github.com/armstjc/Nippon-Baseball-Data-Repository</a>
        </p>
        <p>An unofficial fan project, not affiliated with NPB or its clubs. Player names and photos are from npb.jp. <Link to="/glossary#method">How the numbers are built</Link></p>
      </footer>
    </>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      {/* The site may be served from a sub-path (GitHub Pages), so routes hang off Vite's base. */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ScrollToTop />
        <Shell />
      </BrowserRouter>
    </SettingsProvider>
  )
}
