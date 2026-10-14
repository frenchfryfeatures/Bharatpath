// Modern: Noto Sans, one accent colour, name set left, dates flush right in
// grey, headings in spaced capitals.
#import "common.typ": *

#let data = load()
#let heads = data.headings
#let accent = rgb("#1d4e89")
#let muted = rgb("#5b6470")

#show: setup.with(data)
#set page(paper: "a4", margin: (x: 1.7cm, y: 1.6cm))
#set text(font: sans, size: 9.8pt, fill: rgb("#1f2328"))
#set par(justify: false, leading: 0.62em, spacing: 0.85em)
#set list(indent: 0.4em, body-indent: 0.5em, spacing: 0.5em, marker: text(fill: accent)[•])
#show link: set text(fill: accent)

#let section(title) = block(above: 1.25em, below: 0.65em, sticky: true)[
  #text(size: 10.5pt, weight: "bold", fill: accent, tracking: 0.08em, upper(title))
  #v(-0.6em)
  #line(length: 100%, stroke: 0.6pt + accent.lighten(55%))
]

#let entry(title, place, dates, sub) = block(above: 0.8em, below: 0.45em, sticky: true)[
  #grid(
    columns: (1fr, auto),
    column-gutter: 1em,
    row-gutter: 0.35em,
    [*#title*#if place != none [ #text(fill: muted)[·] #text(fill: accent, place)]],
    text(fill: muted, size: 9pt, dates),
    ..if sub != none { (text(fill: muted, size: 9pt, sub), []) } else { () },
  )
]

#block(below: 0.4em)[
  #text(size: 24pt, weight: "bold", data.name)
  #if data.headline != "" [
    #v(-0.5em)
    #text(size: 11.5pt, fill: accent, data.headline)
  ]
]
#text(size: 9pt, fill: muted, joined(data.contacts.map(contact), [#h(0.5em)·#h(0.5em)]))

#if data.summary != "" {
  section(heads.summary)
  data.summary
}

#if data.experience.len() > 0 {
  section(heads.experience)
  for e in data.experience {
    entry(
      if e.title != "" { e.title } else { e.company },
      if e.title != "" and e.company != "" { e.company } else { none },
      e.dates,
      joined((e.location, e.kind), [ · ]),
    )
    if e.description != "" { par(e.description) }
    bullets(e.highlights)
    if e.skills != "" { text(size: 9pt, fill: muted)[#e.skills] }
  }
}

#if data.projects.len() > 0 {
  section(heads.projects)
  for p in data.projects {
    entry(
      if p.name != "" { p.name } else { p.role },
      if p.name != "" and p.role != "" { p.role } else { none },
      p.dates,
      if p.url_text != "" { maybe-link(p.url, p.url_text) } else { none },
    )
    if p.description != "" { par(p.description) }
    if p.technologies != "" { text(size: 9pt, fill: muted)[#p.technologies] }
  }
}

#if data.education.len() > 0 {
  section(heads.education)
  for e in data.education {
    entry(
      joined((e.qualification, e.field), [ in ]),
      if e.institution != "" { e.institution } else { none },
      e.dates,
      joined((e.location, e.grade), [ · ]),
    )
    if e.description != "" { par(e.description) }
  }
}

#if data.skills.len() > 0 {
  section(heads.skills)
  data.skills.map(s => box(
    inset: (x: 0.45em, y: 0.25em),
    radius: 2pt,
    fill: accent.lighten(88%),
    text(size: 9pt, s),
  )).join(h(0.35em))
}

#if data.certifications.len() > 0 {
  section(heads.certifications)
  for c in data.certifications {
    entry(c.name, if c.issuer != "" { c.issuer } else { none }, c.dates,
      if c.url_text != "" { maybe-link(c.url, c.url_text) } else { none })
  }
}

#if data.languages.len() > 0 {
  section(heads.languages)
  data.languages.map(l => if l.level != "" [*#l.name* #text(fill: muted)[#l.level]] else [*#l.name*]).join(h(1.2em))
}

#if data.achievements.len() > 0 {
  section(heads.achievements)
  bullets(data.achievements)
}

#for s in data.other_sections {
  section(if s.heading != "" { s.heading } else { "Additional information" })
  bullets(s.items)
}

#if data.interests.len() > 0 {
  section(heads.interests)
  data.interests.join(" · ")
}
