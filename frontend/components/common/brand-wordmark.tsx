/** Shared wordmark colors. Keep Path orange on light and dark surfaces. */
export function BrandWordmark({ light = false }: { light?: boolean }) {
  return <span className="whitespace-nowrap" style={{ color: light ? '#FFFFFF' : '#05255C' }}>Bharat<span style={{ color: '#FF8A26' }}>Path</span></span>;
}
