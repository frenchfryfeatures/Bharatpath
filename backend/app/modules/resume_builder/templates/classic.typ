// Classic: the LaTeX article look. New Computer Modern, centred name,
// small-caps headings over a hairline rule, dates flush right.
#import "common.typ": *

#let data = load()
#let heads = data.headings

#show: setup.with(data)
#set page(paper: "a4", margin: (x: 1.9cm, y: 1.7cm))
#set text(font: serif-cm, size: 10.5pt)
#set par(justify: true, leading: 0.6em, spacing: 0.9em)
#set list(indent: 0.6em, body-indent: 0.5em, spacing: 0.45em)

#let section(title) = block(above: 1.15em, below: 0.6em, sticky: true)[
  #text(size: 12pt, weight: "bold", smallcaps(title))
  #v(-0.7em)
  #line(length: 100%, stroke: 0.5pt)
]

#let entry(title, right, sub, sub-right) = block(above: 0.75em, below: 0.4em, sticky: true)[
  #grid(
    columns: (1fr, auto),
    column-gutter: 1em,
    row-gutter: 0.4em,
    strong(title), right,
    ..if sub != none or sub-right != "" { (emph(if sub == none { [] } else { sub }), emph(sub-right)) } else { () },
  )
]

#align(center)[
  #text(size: 22pt, weight: "bold", data.name)
  #if data.headline != "" [
    #v(-0.35em)
    #text(size: 11pt, style: "italic", data.headline)
  ]
  #v(-0.2em)
  #text(size: 9.5pt, joined(data.contacts.map(contact), [ #h(0.3em)|#h(0.3em) ]))
]

#if data.summary != "" {
  section(heads.summary)
  data.summary
}

#if data.experience.len() > 0 {
  section(heads.experience)
  for e in data.experience {
    entry(
      joined((e.title, e.company), [, ]),
      e.dates,
      joined((e.location, e.kind), [ · ]),
      "",
    )
    if e.description != "" { par(e.description) }
    bullets(e.highlights)
    if e.skills != "" { text(size: 9.5pt)[_Skills:_ #e.skills] }
  }
}

#if data.projects.len() > 0 {
  section(heads.projects)
  for p in data.projects {
    entry(
      joined((p.name, p.role), [ --- ]),
      p.dates,
      if p.url_text != "" { maybe-link(p.url, p.url_text) } else { none },
      "",
    )
    if p.description != "" { par(p.description) }
    if p.technologies != "" { text(size: 9.5pt)[_Technologies:_ #p.technologies] }
  }
}

#if data.education.len() > 0 {
  section(heads.education)
  for e in data.education {
    entry(
      joined((e.qualification, e.field), [, ]),
      e.dates,
      joined((e.institution, e.location), [, ]),
      e.grade,
    )
    if e.description != "" { par(e.description) }
  }
}

#if data.skills.len() > 0 {
  section(heads.skills)
  data.skills.join(" · ")
}

#if data.certifications.len() > 0 {
  section(heads.certifications)
  for c in data.certifications {
    block(above: 0.5em, below: 0.5em, grid(
      columns: (1fr, auto),
      column-gutter: 1em,
      [*#c.name*#if c.issuer != "" [, #c.issuer]#if c.url_text != "" [ --- #maybe-link(c.url, c.url_text)]],
      c.dates,
    ))
  }
}

#if data.languages.len() > 0 {
  section(heads.languages)
  data.languages.map(l => if l.level != "" [#l.name (#l.level)] else [#l.name]).join([ · ])
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
