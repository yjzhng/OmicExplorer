export function IconGuide({ size = 17 }: { size?: number } = {}) {
  // Open book — "user guide".
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 6.5C10.8 5.5 9 5 6.5 5H3v13h3.5c2.5 0 4.3.5 5.5 1.5" />
      <path d="M12 6.5C13.2 5.5 15 5 17.5 5H21v13h-3.5c-2.5 0-4.3.5-5.5 1.5z" />
    </svg>
  )
}
export function IconHome() {
  // House — "back to the project home".
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
}
