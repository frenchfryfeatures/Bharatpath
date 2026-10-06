/*
 * ==========================================================================
 * STUDENT PORTAL - DESIGN TOKENS
 *
 * Lifted from the candidate-app prototype + BharatPath Design System. The rest
 * of the portal uses Tailwind arbitrary values (the repo convention); these
 * constants exist for the few places that need the colour in JS - the score
 * ring gradient, canvas-like SVGs, and shared portal tints.
 * ==========================================================================
 */

export const studentTheme = {
  primary: "#5F4DB2",
  primaryDark: "#4A3E8F",
  bg: "#FFFCF7",
  navy: "#0A1931",
  ink: "#3A4761",
  inkMuted: "#5F6B80",
  inkOnNavyMuted: "#9DA9BE",

  gold: "#D4AF37",
  goldOnNavy: "#F4D685",
  goldOnCream: "#B9891A",

  borderCard: "#E7E0D4",
  borderHair: "#F0EBDF",
  surfaceTint: "#F7F4EC",

  green: "#1F6B45",
  greenBg: "#E6F1EA",
  amber: "#7A5C0E",
  amberBg: "#F7EFD6",
  indigoTint: "#4A3E8F",
  indigoBg: "#F1EAF7",
  red: "#993A22",
  redBg: "#F8E6E0",
} as const;
