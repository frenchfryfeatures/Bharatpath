// Shared by the four resume templates.
//
// The data arrives as one JSON string in `sys.inputs.data`, already formatted
// by `resume_builder.domain.template_view`: every date, link and contact is a
// finished string. A template only lays strings out. Typst prints a string as
// it is, so nothing a candidate types is ever read as markup or code.
//
// Fonts are the bundled Noto families plus the ones Typst embeds (New
// Computer Modern, Libertinus Serif). System fonts are ignored, so a resume
// renders the same on a laptop, in CI and on the server.

#let indic = (
  "Noto Sans Devanagari",
  "Noto Sans Bengali",
  "Noto Sans Gurmukhi",
  "Noto Sans Gujarati",
  "Noto Sans Kannada",
  "Noto Sans Tamil",
  "Noto Sans Telugu",
)
#let sans = ("Noto Sans",) + indic
#let serif-cm = ("New Computer Modern",) + indic
#let serif-lib = ("Libertinus Serif",) + indic

#let load() = json(bytes(sys.inputs.data))

// A link only when the domain layer allowed one (http, https or mailto).
#let maybe-link(url, body) = if url != "" { link(url, body) } else { body }

// Parts that are present, joined; `none` when none are.
#let joined(parts, sep) = {
  let present = parts.filter(p => p != none and p != "")
  if present.len() == 0 { none } else { present.join(sep) }
}

// One contact never breaks across lines: an address split at a slash is unreadable.
#let contact(c) = box(maybe-link(c.url, c.text))

#let bullets(items) = if items.len() > 0 {
  list(..items.map(i => [#i]))
}

// Applied by every template, so the PDF carries the same metadata whichever
// layout drew it, and two renders of one draft are byte-identical.
#let setup(data, body) = {
  set document(
    title: if data.name != "" { data.name + " - Resume" } else { "Resume" },
    author: if data.name != "" { data.name } else { () },
    date: none,
  )
  set text(lang: "en", region: "IN")
  body
}
