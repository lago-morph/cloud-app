# KubeCon + CloudNativeCon North America 2026: schedule data source

Researched 2026-11-09 (UTC) from the cloud sandbox. Raw downloads are in `data/raw/`.

## Summary

The official schedule pages on events.linuxfoundation.org are built by the LF WordPress
plugin `sessionize-blocks`, which renders the schedule server-side from the **Sessionize
public API**. Each schedule page carries its Sessionize API code in the
`data-sched-config` attribute of `div.sched-wrapper`. The API is public JSON: no auth,
no bot challenge, CORS `*`. Sched is not used.

There are **separate Sessionize feeds**. The main feed has only umbrella placeholders for
the Monday co-located events; the individual Monday co-located talks are in a second feed.

| Feed | API code | Schedule page (official) | Sessions | Sun 11/08 | Mon 11/09 | Tue 11/10 | Wed 11/11 | Thu 11/12 | Speakers | Rooms |
|---|---|---|---|---|---|---|---|---|---|---|
| Main conference | `svi82w6c` | `https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/` | 600 | 4 | 78 | 194 | 203 | 121 | 712 | 37 |
| CNCF-hosted co-located events | `ayajbd6b` | `https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/co-located-events/cncf-hosted-co-located-schedule/` | 229 | 2 | 227 | 0 | 0 | 0 | 276 | 19 |
| Sponsor-hosted co-located events | `etvmcsmr` | `https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/co-located-events/sponsor-hosted-co-located-schedule/` | 14 | 1 | 12 | 0 | 1 | 0 | 0 | 37 |
| CNCF Maintainer Summit (Sunday) | `qtujim6y` | `https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/features-add-ons/maintainer-summit/` | 40 | 40 | 0 | 0 | 0 | 0 | 38 | - |

- Session IDs are disjoint between main, CNCF co-located and Maintainer Summit (869 unique).
- All 14 sponsor-hosted sessions are **also in the main feed** (same IDs); that feed is
  redundant if the main feed is used.
- All main and CNCF co-located sessions have `status: "Accepted"`; none lacks a start time.

## Endpoints

```
GET https://sessionize.com/api/v2/{code}/view/All        # sessions + speakers + categories + rooms + questions (normalized, IDs)
GET https://sessionize.com/api/v2/{code}/view/GridSmart  # per-day -> rooms -> sessions, with room name + category names inlined
GET https://sessionize.com/api/v2/{code}/view/Sessions   # [{groupName, sessions[]}], categories and room inlined
GET https://sessionize.com/api/v2/{code}/view/Speakers   # speakers with their sessions
```

Tested with plain `curl` (no headers, no cookies) and with a Workers-like User-Agent and
an `Origin` header: all `200 application/json; charset=utf-8`.
Sizes (All): main 1.97 MB, CNCF co-located 0.79 MB, sponsor 33 KB, Maintainer Summit 119 KB.

Response headers seen (main/All):
```
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=70
Last-Modified: Mon, 09 Nov 2026 16:24:25 GMT
Vary: *
```
No `cf-ray`/Cloudflare header; the server is Sessionize's own (Azure App Insights
`Request-Context`).

## Format (`view/All`)

Top level: `{ sessions[], speakers[], questions[], categories[], rooms[] }`.

Session record (CNCF co-located feed, description trimmed):
```json
{
 "id": "1312037",
 "title": "Welcome + Opening Remarks",
 "description": "...",
 "startsAt": "2026-11-09T09:00:00",
 "endsAt": "2026-11-09T09:05:00",
 "isServiceSession": false,
 "isPlenumSession": false,
 "speakers": ["6d0940ee-a221-46b7-ac1c-f1d8056dd5b3", "1719838f-3509-400d-a52d-f9ff606f5f1d"],
 "categoryItems": [468982, 502727],
 "questionAnswers": [],
 "roomId": 83561,
 "liveUrl": null, "recordingUrl": null,
 "status": "Accepted", "isInformed": true, "isConfirmed": true
}
```
- Room: `rooms[] = {id, name, sort}`, e.g. `{"id":83561,"name":"Salt Palace | Level 1 | Grand Ballroom H","sort":0}`.
  Names are `Venue | Level | Room`; off-site sponsor events use `Off-Site Location`.
- Speaker: `{id, firstName, lastName, fullName, bio, tagLine, profilePicture, isTopSpeaker, links[], sessions[], categoryItems[], questionAnswers[]}`.
  Company and title are in `questionAnswers` (questions `Company`, `Speaker Title`); `tagLine` is "Company, Title".
- Categories: `categories[] = {id, title, sort, type, items[{id,name,sort}]}`; a session's
  `categoryItems` are item IDs.
  - Main feed: `All Sessions` (track/type, 30 values such as Keynote Sessions, Maintainer
    Track, AI Inference + Agentic, Project Lightning Talks, CNCF-hosted Co-located Events,
    Sponsor-hosted Co-located Events, Breaks, Registration), `Audience Level`, `SubTopic`,
    `CNCF Projects` (104), and three flags.
  - CNCF co-located feed: `All Sessions` holds the **co-located event name** (Agentics Day:
    MCP + Agents, ArgoCon, BackstageCon, CiliumCon, Cloud Native AI + Inference Day, FluxCon,
    Kubernetes on Edge Day, Observability Day, Open Source SecurityCon, OpenTofu Day,
    Platform Engineering Day, plus Breaks/Registration/Experiences); per-event topic
    categories; `Session format` (Breakout 131, Keynote 24, Lightning Talk 32, Panel 4);
    `Audience Level`.
- Session `questionAnswers` (main feed) carry links: `Presentation Slides`, `GitHub Repository`,
  `Project Demo`, `Website`, `Location Map`.
- Day: derive from `startsAt[:10]`.

### Timezone caveat
`startsAt`/`endsAt` are **local wall-clock with no offset**. Venue is Salt Lake City,
`America/Denver`; US DST ended 2026-11-01, so all dates are MST, UTC-07:00. The LF page's
`<time datetime>` attributes are likewise offset-free.

## Monday 2026-11-09 coverage

- Main feed (78): 51 Project Lightning Talks, 11 CNCF-hosted co-located **umbrella blocks**
  (one per event, no speakers, e.g. "ArgoCon Hosted by CNCF - Full Day Event | ALL ACCESS
  PASS REQUIRED", with an event-page link in `questionAnswers`), 12 sponsor-hosted
  co-located events (mostly off-site, separate registration, no speakers), 2 registration,
  2 experiences.
- CNCF co-located feed (227 on Monday), by event: Agentics Day 33, ArgoCon 33, Cloud
  Native AI + Inference Day 33, Observability Day 32, Platform Engineering Day 31,
  BackstageCon 20, Open Source SecurityCon 19, CiliumCon 13, Kubernetes on Edge Day 13,
  OpenTofu Day 13, FluxCon 12, Breaks 10, Registration 2, Experiences 1 (one session can
  count in more than one category).
- When merging, drop the 11 main-feed umbrella blocks (or keep them only as headers), or
  they duplicate the detailed co-located talks. Registration/coat-check entries also appear
  in both feeds under different IDs.

## Fallback: HTML

The LF pages are server-rendered (`data-sched-ssr="1"`): `div.sess-wrap` >
`a.sess-link[data-session-id]`, `.sess__title`, `.sess__room`, `.tag--primary`, and a hidden
`.sess__seo` block with `<time datetime>` start/end and `.sess__seodesc`. The main page
is 3.6 MB for 600 sessions. Use it only if the API stops working.

## Runtime fetch from a Cloudflare Worker

This should work: public GET, no auth, no cookies, no challenge, `Access-Control-Allow-Origin: *`
(so a browser could also call it directly). Sessionize sets `max-age=70`; cache in the Worker
(for example 5 to 15 minutes via `caches.default` or KV) and avoid fetching on every request.
No rate-limit headers were returned and none was hit in about 10 requests. Sessionize publishes
no limit, so stay polite. Not tested from a real Worker; tested only from this sandbox through
its egress proxy.

## Caveats

- The API codes come from the LF pages, and LF can change them. To rediscover them, read the
  `data-sched-config` attribute (HTML-entity-encoded JSON, key `sessionizeApiCode`) from the
  schedule pages above.
- Schedule changes are live; `Last-Modified` updated minutes before the fetch (the conference
  starts on 2026-11-08 and today is 2026-11-09).
- Not checked: any other Monday programs outside these four feeds (for example a separate
  Kubernetes Contributor Summit). None was linked from the pages examined.
- Public Sessionize event pages for attendees: `https://kubecon-cloudnativecon-north-america-2026.sessionize.com`,
  `cncf-hosted-co-located-events-north-america-2026` (slug), `https://maintainer-summit-na-2026.sessionize.com/`.

## Raw files (`data/raw/`)

- `lf-kcna.html`, `lf-kcna-program.html`: LF event home and main schedule page
- `colo/*.html`: ArgoCon page, CNCF and sponsor co-located schedule pages, Maintainer Summit page
- `sessionize-svi82w6c-{All,GridSmart,Sessions,Speakers}.json` (+ `.headers`): main feed
- `sessionize-ayajbd6b-All.json`: CNCF-hosted co-located feed
- `sessionize-etvmcsmr-All.json`: sponsor-hosted co-located feed
- `sessionize-qtujim6y-All.json`: Maintainer Summit feed
