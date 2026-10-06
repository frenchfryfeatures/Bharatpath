/**
 * Web font CSS injection.
 * Loads clean Inter font family and Space Mono / Noto Sans for web.
 */
import { Platform } from 'react-native';

const webFontCSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap');

@font-face {
  font-family: 'SpaceMono-Regular';
  src: local('Space Mono'), local('SpaceMono-Regular'), monospace;
  font-weight: 100 900;
  font-style: normal;
}
@font-face {
  font-family: 'SpaceMono-Bold';
  src: local('Space Mono Bold'), local('SpaceMono-Bold'), monospace;
  font-weight: 100 900;
  font-style: normal;
}
@font-face {
  font-family: 'NotoSansDevanagari-Regular';
  src: local('Noto Sans Devanagari'), local('NotoSansDevanagari-Regular'), sans-serif;
  font-weight: 100 900;
  font-style: normal;
}
@font-face {
  font-family: 'NotoSansDevanagari-Medium';
  src: local('Noto Sans Devanagari Medium'), local('NotoSansDevanagari-Medium'), sans-serif;
  font-weight: 100 900;
  font-style: normal;
}
`;

export function injectWebFonts() {
  if (Platform.OS === 'web') {
    const styleId = 'bharatpath-web-fonts';
    if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = webFontCSS;
      document.head.appendChild(style);
    }
  }
}
