# Privacy Policy — UNDAWN

_Last updated: 13 August 2026_

UNDAWN is a self-hosted moderation and audit-logging bot operated for a single
Discord community. This policy describes exactly what it collects, why, how long
it is kept, and who can see it.

## Who operates this bot

The bot is run by the staff of the community it serves, on hardware they own. It
is not a public bot and is not offered as a service to other servers. There is no
company behind it and no commercial use of any data.

## What the bot receives

To do its job the bot receives, from Discord's gateway:

- **Message content** in channels it can see
- **Member join and leave events**, including account creation dates
- **Voice state changes** (joining, leaving, moving between voice channels; mute,
  deafen, screen share, camera)
- **Audit log entries** (bans, kicks, timeouts, role and channel changes)

## What is stored, and for how long

Most of what the bot receives is used and immediately discarded. Message content
in particular is **not** stored: messages are scored in memory and then dropped.

| Data | Purpose | Retention |
|---|---|---|
| Excerpt (first 180 characters) of a message that was **flagged or deleted** by moderation | So staff can review whether the action was correct | **90 days**, then deleted automatically |
| Moderation records: who was banned, kicked, timed out or warned, by whom, and why | Accountability for staff actions | **90 days**, then deleted automatically |
| Member join and leave records (user ID, username, account age) | Investigating raids and scam waves after the fact | **90 days**, then deleted automatically |
| Voice activity records (which channel, mute/deafen state changes) | Moderating voice channels | **90 days**, then deleted automatically |
| Member profile card data (member number, join date, and self-chosen fields) | The server's member-card feature, which members opt into by registering | Until the member asks for it to be removed |
| Activity counters (message count, voice minutes, XP) | The server's levelling feature | Until the member asks for it to be removed |
| Text of a flagged message **that a moderator explicitly labelled** as a correct or incorrect detection | Labelled training data used to improve the Thai-language classifier | **Kept indefinitely** |

The last row is the only data kept beyond 90 days that the member did not opt
into. It is created only when a moderator deliberately presses a button in the
dashboard to record a judgement — never automatically. It is used for no purpose
other than improving detection accuracy for this community.

## What is never done

- Message content is **never sent to any third party.** The text classifier runs
  on the same machine as the bot, reachable only on `127.0.0.1`. There is no
  external AI API, no analytics provider, and no advertising.
- Data is **never sold, shared, or published.**
- Direct messages are not read or stored.

## Where it is stored and who can reach it

All data lives in a single SQLite database file on the operator's own device. A
nightly backup is written to the same device and does not leave it.

The only way to read this data is a web dashboard that listens on `127.0.0.1`
and is reachable exclusively over a private network (Tailscale) by the server's
staff, behind username and password authentication. It is not exposed to the
public internet.

Passwords are stored as scrypt hashes. Session tokens are stored as SHA-256
hashes rather than in plaintext, so that a copy of the database cannot be used to
impersonate a signed-in user.

## Your choices

Members of the community may ask the server staff to:

- **See** what the bot has stored about them
- **Delete** their member card, activity counters, and any retained records

Requests can be made to the server staff through the community's support channel
or by direct message to a moderator. Records covered by the 90-day retention
periods above are deleted automatically regardless of whether a request is made.

## Changes

If this policy changes, the updated version replaces this file and the date at
the top is updated.
