---
title: Dotted
lists:
  checklist:
    drive-file: ABC
    owner: Ada
    steps:
      - first
      - second
edition: pro
---
# {!var(title)!}

Drive file: {!var(lists.checklist.drive-file)!}
Owner: {!var(lists.checklist.owner)!}

{!if lists.checklist.drive-file=ABC!}
Checklist is linked to ABC.
{!else!}
No checklist link.
{!endif!}
