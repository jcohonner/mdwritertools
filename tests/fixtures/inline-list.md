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
!}

Some narrative text follows the inline item.

## Later

{!list-add backlog
name: MFA
priority: P2
owner: Lin
!}

{!list-add backlog
name: SSO
priority: P3
owner: Sam
inline: false
!}

{!list-table(list=backlog|columns=name:Item,priority:Priority)!}
