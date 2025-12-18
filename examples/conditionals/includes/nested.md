---
edition: community
---
# Details
{!if edition=pro!}
## Nested Pro Detail
Root variable wins even if this file defines its own edition.
{!elseif edition=community!}
## Nested Community Detail
Appears only when the entry file sets edition to community.
{!else!}
## Nested Default Detail
Shown when the edition is not explicitly handled.
{!endif!}
{!if client=toto!}
## Client Specific Detail
Client {!var(client)!} can see this nested note.
{!endif!}
