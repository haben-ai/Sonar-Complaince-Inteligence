/** "MACH. STORES (MAIN DECK)" -> "MACH. STORES" when the suffix names a deck. */
export function stripDeck(name: string | undefined | null, deckNames: string[]): string {
  if (!name) return ''
  const m = name.match(/^(.*) \(([^)]+)\)$/)
  return m && (deckNames.includes(m[2]) || /\bDECK\b|TANKTOP|TANK TOP|BOTTOM/i.test(m[2])) ? m[1] : name
}
