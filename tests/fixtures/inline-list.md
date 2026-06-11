---
lists:
  backlog:
    name: project-backlog
    inline: **${name}** — priority ${priority}, owner {owner}
    columns:
      name: Item
      priority: Priority
---
# Roadmap

## Now

{!list-add backlog
name: Login
priority: P1
owner: Ada
inline
!}

Some narrative text follows the inline item.

## Later

{!list-add backlog
name: MFA
priority: P2
owner: Lin
!}

{!list-table(list=backlog|columns=name:Item,priority:Priority)!}
