// Sidebar: two columns. Contact details, skills, languages and the short
// lists in a tinted strip on the left; summary, experience, projects and
// education on the right. The strip is drawn on every page.
#import "common.typ": *

#let data = load()
#let heads = data.headings
#let ink = rgb("#20313b")
#let accent = rgb("#0e6e6e")
#let tint = rgb("#eef4f4")
#let muted = rgb("#5a6670")
#let strip = 6.3cm

#show: setup.with(data)
#set page(
  paper: "a4",
  margin: (x: 0cm, y: 1.5cm),
  background: place(left + top, rect(width: strip, height: 100%, fill: tint)),
)
#set text(font: sans, size: 9.6pt, fill: ink)
#set par(justify: false, leading: 0.6em, spacing: 0.8em)
#set list(indent: 0.2em, body-indent: 0.45em, spacing: 0.45em, marker: text(fill: accent)[▪])
#show link: set text(fill: accent)

#let side-section(title) = block(above: 1.3em, below: 0.55em, sticky: true)[
  #text(size: 9.5pt, weight: "bold", fill: accent, tracking: 0.1em, upper(title))
]

#let section(title) = block(above: 1.3em, below: 0.6em, sticky: true)[
  #text(size: 11pt, weight: "bold", fill: accent, upper(title))
  #v(-0.3em)
  #line(length: 2.2em, stroke: 1.6pt + accent)
]

#let entry(title, place, dates, sub) = block(above: 0.85em, below: 0.4em, sticky: true)[
  *#title*
  #if place != none [ \ #text(fill: accent, place)]
  #let meta = joined((dates, sub), [ · ])
  #if meta != none [ \ #text(size: 8.8pt, fill: muted, meta)]
]

#let sidebar = {
  if data.contacts.len() > 0 {
    side-section(heads.contact)
    for c in data.contacts {
      block(above: 0.55em, below: 0.55em)[
        #text(size: 7.8pt, fill: muted, upper(c.label)) \
        #text(size: 9pt, maybe-link(c.url, c.text))
      ]
    }
  }
  if data.skills.len() > 0 {
    side-section(heads.skills)
    for s in data.skills { block(above: 0.4em, below: 0.4em, s) }
  }
  if data.languages.len() > 0 {
    side-section(heads.languages)
    for l in data.languages {
      block(above: 0.45em, below: 0.45em)[
        #l.name#if l.level != "" [ \ #text(size: 8.6pt, fill: muted, l.level)]
      ]
    }
  }
  if data.certifications.len() > 0 {
    side-section(heads.certifications)
    for c in data.certifications {
      block(above: 0.55em, below: 0.55em)[
        *#c.name*
        #let meta = joined((c.issuer, c.dates), [ · ])
        #if meta != none [ \ #text(size: 8.6pt, fill: muted, meta)]
        #if c.url_text != "" [ \ #text(size: 8.6pt, maybe-link(c.url, c.url_text))]
      ]
    }
  }
  if data.interests.len() > 0 {
    side-section(heads.interests)
    data.interests.join(", ")
  }
}

#let main = {
  block(below: 0.2em, text(size: 23pt, weight: "bold", data.name))
  if data.headline != "" { block(above: 0.5em, text(size: 11pt, fill: accent, data.headline)) }

  if data.summary != "" {
    section(heads.summary)
    data.summary
  }
  if data.experience.len() > 0 {
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
      if e.skills != "" { text(size: 8.8pt, fill: muted)[#e.skills] }
    }
  }
  if data.projects.len() > 0 {
    section(heads.projects)
    for p in data.projects {
      entry(
        if p.name != "" { p.name } else { p.role },
        if p.name != "" and p.role != "" { p.role } else { none },
        p.dates,
        if p.url_text != "" { maybe-link(p.url, p.url_text) } else { none },
      )
      if p.description != "" { par(p.description) }
      if p.technologies != "" { text(size: 8.8pt, fill: muted)[#p.technologies] }
    }
  }
  if data.education.len() > 0 {
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
  if data.achievements.len() > 0 {
    section(heads.achievements)
    bullets(data.achievements)
  }
  for s in data.other_sections {
    section(if s.heading != "" { s.heading } else { "Additional information" })
    bullets(s.items)
  }
}

#grid(
  columns: (strip, 1fr),
  grid.cell(inset: (x: 0.85cm), sidebar),
  grid.cell(inset: (left: 0.8cm, right: 1.5cm), main),
)
