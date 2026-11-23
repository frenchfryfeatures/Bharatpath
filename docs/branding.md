# BharatPath branding

Use the complete navy B and orange arrow mark, with a two-color wordmark:

- **Bharat:** navy `#05255C` (white on dark surfaces for contrast).
- **Path:** orange `#FF8A26` on both light and dark surfaces.
- Keep the existing logo gradient and aspect ratio; do not tint the mark or substitute a plain B.

Web components: `components/common/brand-icon.tsx` and `brand-wordmark.tsx`. These are shared by the website, authentication, onboarding and Student, Employer, College and Admin shells. The public logo and metadata icon use the same complete mark.

Mobile: `components/BrandWordmark.tsx` owns the wordmark colors. `assets/icons/bharatpath-icon.png` is the complete mark, matching the web asset. The existing launcher, adaptive and splash icons already include the arrow and retain their platform-safe padding.

Streak records are labelled **Longest Streak**, including tooltips. Changes here affect presentation, not point rewards or deductions.
