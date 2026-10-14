// Minimal: Libertinus Serif, no colour, no rules. Headings in a narrow left
// margin column, content beside them. Plain enough for any applicant
// tracking system to read in order.
#import "common.typ": *

#let data = load()
#let heads = data.headings
#let muted = luma(90)
#let label-width = 3.1cm

#show: setup.with(data)
#set page(paper: "a4", margin: (x: 2cm, y: 1.9cm))
#set text(font: serif-lib, size: 10.8pt)
#set par(justify: true, leading: 0.62em, spacing: 0.85em)
#set list(indent: 0em, body-indent: 0.5em, spacing: 0.45em, marker: [–])

#let section(title, body) = block(above: 1.3em, below: 0.8em)[
  #grid(
    columns: (label-width, 1fr),
    column-gutter: 0.6em,
    text(size: 9.5pt, weight: "bold", tracking: 0.06em, upper(title)),
    body,
  )
]

#let entry(title, dates, sub) = block(above: 0em, below: 0.45em, sticky: true)[
  #grid(
    columns: (1fr, auto),
    column-gutter: 1em,
    row-gutter: 0.3em,
    strong(title), text(fill: muted, dates),
    ..if sub != none { (text(fill: muted, sub), []) } else { () },
  )
]

#let entries(items) = items.map(it => block(below: 0.95em, it)).join()

#block(below: 1.1em)[
  #text(size: 21pt, data.name)
  #if data.headline != "" [ \ #text(size: 11.5pt, fill: muted, data.headline)]
  #if data.contacts.len() > 0 [
    \ #text(size: 9.5pt, joined(data.contacts.map(contact), [#h(0.6em)/#h(0.6em)]))
  ]
]

#if data.summary != "" { section(heads.summary, data.summary) }

#if data.experience.len() > 0 {
  section(heads.experience, entries(data.experience.map(e => [
    #entry(joined((e.title, e.company), [, ]), e.dates, joined((e.location, e.kind), [, ]))
    #if e.description != "" { par(e.description) }
    #bullets(e.highlights)
    #if e.skills != "" { text(fill: muted, size: 9.8pt, e.skills) }
  ])))
}

#if data.projects.len() > 0 {
  section(heads.projects, entries(data.projects.map(p => [
    #entry(joined((p.name, p.role), [, ]), p.dates,
      if p.url_text != "" { maybe-link(p.url, p.url_text) } else { none })
    #if p.description != "" { par(p.description) }
    #if p.technologies != "" { text(fill: muted, size: 9.8pt, p.technologies) }
  ])))
}

#if data.education.len() > 0 {
  section(heads.education, entries(data.education.map(e => [
    #entry(joined((e.qualification, e.field), [, ]), e.dates,
      joined((e.institution, e.location, e.grade), [, ]))
    #if e.description != "" { par(e.description) }
  ])))
}

#if data.skills.len() > 0 { section(heads.skills, data.skills.join(", ")) }

#if data.certifications.len() > 0 {
  section(heads.certifications, entries(data.certifications.map(c => entry(
    c.name,
    c.dates,
    joined((c.issuer, if c.url_text != "" { maybe-link(c.url, c.url_text) } else { none }), [, ]),
  ))))
}

#if data.languages.len() > 0 {
  section(heads.languages,
    data.languages.map(l => if l.level != "" [#l.name (#l.level)] else [#l.name]).join([, ]))
}

#if data.achievements.len() > 0 { section(heads.achievements, bullets(data.achievements)) }

#for s in data.other_sections {
  section(if s.heading != "" { s.heading } else { "Additional" }, bullets(s.items))
}

#if data.interests.len() > 0 { section(heads.interests, data.interests.join(", ")) }
