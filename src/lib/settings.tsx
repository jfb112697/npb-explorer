import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { VeloUnit } from './stats'

type Theme = 'light' | 'dark'
interface Settings {
  unit: VeloUnit
  setUnit: (u: VeloUnit) => void
  theme: Theme
  setTheme: (t: Theme) => void
}
const Ctx = createContext<Settings>({ unit: 'mph', setUnit: () => {}, theme: 'light', setTheme: () => {} })

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode: the choice just lasts for this visit */ }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<VeloUnit>(() => read('npb.unit', 'mph', ['mph', 'kmh']))
  const [theme, setThemeState] = useState<Theme>(() =>
    read('npb.theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', ['light', 'dark']),
  )
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const value = useMemo(
    () => ({
      unit, theme,
      setUnit: (u: VeloUnit) => { setUnitState(u); write('npb.unit', u) },
      setTheme: (t: Theme) => { setThemeState(t); write('npb.theme', t) },
    }),
    [unit, theme],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = () => useContext(Ctx)
