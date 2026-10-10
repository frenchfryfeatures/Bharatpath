/**
 * Opens a short-lived (presigned) document link in a new tab.
 *
 * The tab is opened synchronously, inside the click, so popup blockers allow
 * it; the link is only fetched afterwards. That lets the caller refetch first,
 * so a drawer or page that has been open for more than the link's lifetime
 * (15 minutes) never hands over an expired URL.
 *
 * Returns false when no link could be resolved, so the caller can say so.
 */
export async function openFreshDocument(
  resolveUrl: () => Promise<string | null | undefined>,
): Promise<boolean> {
  const tab = window.open("about:blank", "_blank");

  if (tab) {
    tab.opener = null;
  }

  try {
    const url = await resolveUrl();

    if (url && tab) {
      tab.location.href = url;
      return true;
    }
  } catch {
    // Falls through to closing the blank tab.
  }

  tab?.close();
  return false;
}
