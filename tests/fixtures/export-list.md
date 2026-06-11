---
edition: pro
lists:
  backlog:
    name: project-backlog
    columns:
      name: Item
      priority: Priority
  notes:
    columns:
      text: Note
---
# Root

## Section A

{!list-add backlog
name: Login
priority: P1
!}

{!list-add notes
text: Important reminder
!}

{!list-add misc
foo: bar
baz: qux
!}

{!include(includes/export-list-child.md)!}
