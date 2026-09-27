import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribeMobileMediaQuery(callback: () => void) {
  if (typeof window === "undefined") return () => {}
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getMobileSnapshot() {
  if (typeof window === "undefined") return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeMobileMediaQuery,
    getMobileSnapshot,
    () => false
  )
}
