export type SystemBarTone = 'light' | 'dark';

export function systemNavigationLayout(height: number, bottomInset: number, tone: SystemBarTone = 'light') {
  const bottom = Number.isFinite(bottomInset) ? Math.min(Math.max(0, bottomInset), Math.max(0, height)) : 0;
  return { bottom, contentHeight: Math.max(0, height - bottom), backgroundColor: tone === 'dark' ? '#000000' : '#FFFFFF', buttonStyle: tone === 'dark' ? 'light' as const : 'dark' as const };
}
