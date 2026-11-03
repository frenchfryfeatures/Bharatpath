import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/site";

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 shrink-0">
      <path fill="currentColor" d="M4.3 2.4c-.2.2-.3.6-.3 1v17.2c0 .4.1.8.3 1l9.6-9.6L4.3 2.4Zm10.8 10.8 2.6 2.6-11.5 6.6c-.4.2-.8.3-1.1.2l10-9.4Zm0-2.4-10-9.4c.3-.1.7 0 1.1.2l11.5 6.6-2.6 2.6Zm3.9-1.8 3 1.7c.9.5.9 1.4 0 1.9l-3 1.7-2.8-2.7 2.8-2.6Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 shrink-0">
      <path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.2 3-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4ZM13.9 5.1c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z" />
    </svg>
  );
}

const badge = "inline-flex min-h-[54px] min-w-[172px] items-center gap-3 rounded-2xl px-4 py-2 text-left transition-all duration-150";

/** Store badges drawn in our own type, not the stores' artwork, so they sit in the page. */
export function AppBadges({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const live = tone === "dark" ? "bg-ink text-white hover:bg-purple-night" : "bg-paper text-ink hover:bg-lavender";
  const soon = tone === "dark" ? "border border-line bg-paper text-muted" : "bg-white/15 text-white";

  return (
    <div className="flex flex-wrap gap-3">
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className={`${badge} ${live}`}>
        <PlayIcon />
        <span className="leading-tight">
          <span className="block text-[13px] opacity-75">Get it on</span>
          <span className="block text-[17px] font-semibold">Google Play</span>
        </span>
      </a>
      {APP_STORE_URL ? (
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className={`${badge} ${live}`}>
          <AppleIcon />
          <span className="leading-tight">
            <span className="block text-[13px] opacity-75">Download on the</span>
            <span className="block text-[17px] font-semibold">App Store</span>
          </span>
        </a>
      ) : (
        <span className={`${badge} ${soon}`} aria-label="App Store: coming soon">
          <AppleIcon />
          <span className="leading-tight">
            <span className="block text-[13px]">Coming soon on the</span>
            <span className="block text-[17px] font-semibold">App Store</span>
          </span>
        </span>
      )}
    </div>
  );
}
