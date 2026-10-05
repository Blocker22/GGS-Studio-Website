# GGS Studio design system

The look of the public site (`style.css`) and the staff dashboard (`admin.css`). Change tokens here first, then in both stylesheets.

## Brand

- **Idea:** a dark, treated studio room with gold light on the gear. Sleek and quiet, never neon.
- **Logo:** `assets/logo-hd.png` (trimmed, for graphics) and `assets/logo-nav.webp` (the nav). Don't recolour it except through the graphics maker's White and Dark logo styles.
- **Voice:** plain, warm, specific. Say what happens next. No em dashes, no exclamation marks in confirmations, sentence case everywhere.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--gold` | `#ffd558` | Primary actions, prices, the selected state. Text on gold is ink `#020304`. |
| `--teal` | `#4dffdb` | Live or good state: open days, confirmed, verified. Never for buttons. |
| `--ink` | `#020304` | Page background, near-black. |
| `--panel` / `--panel-2` / `--panel-3` | `#0a0c0e` / `#0e1113` / `#14181b` | Footer, modals, hover. |
| `--cream` | `#f4f8f8` | Primary text. |
| `--text-2` / `--text-3` | `#a9b1b1` / `#767f7f` | Secondary (9.4:1) and tertiary (4.9:1) text on `--ink`. |
| `--danger` | `#ff8f78` | Errors, cancelled, destructive actions. |

Gold and teal are fixed brand colours and must not change. On the dashboard's light theme they become fills only; text uses `--gold-text` `#7f5d00` and `--teal-text` `#00715f`.

Charts use validated steps of the brand hues: dark `#b88a14` / `#1fa98d`, light `#b8860b` / `#00876f`.

## Type

- **Inter** for everything (400 to 700 on the site, to 800 in the dashboard for graphics), loaded with a `<link>` per page, never `@import`.
- Tabular numbers only where numbers line up: prices, totals, the calendar, timecodes.
- Display `clamp(3.2rem, 9vw, 8.4rem)`, weight 700, tracking `-0.045em`, line-height 0.9. Section titles `clamp(2.2rem, 4.6vw, 4rem)`.
- The hero headline is always three stacked lines: Track it. / Mix it. / Ship it. (the last in gold).

## Shape and surfaces

- **2px corners everywhere.** Only status dots are round.
- **Flat surfaces, no box inside a box.** Groups are separated by 1px hairlines (`--line`). Lists of choices (add-ons, payment options) are rows of one ruled list. Grids of items (services, reviews, the calendar) are hairline grids: a 1px gap over the line colour.
- Notes and messages use a 2px left rule in gold, teal or danger instead of a filled box.
- Shadows only on floating layers (menus, dialogs, toasts), neutral black.

## Icons

Public pages use a handful of inline SVGs (no icon font, for speed). The dashboard uses Phosphor (regular) from `@phosphor-icons/web`.

## Motion

- Native scroll only. Nothing is pinned, snapped or slowed.
- `js/motion.js`: `[data-reveal]` and `[data-stagger]` animate in as they enter and back out as they leave, in the direction of travel. Headings wipe up from a mask; section rules draw across.
- The hero headline rises line by line on load and lifts away as you scroll. The transport bar under it (timecode, waveform, playhead) and the 1px gold line under the nav follow page progress.
- Gallery photos drift inside their frames where `animation-timeline: view()` is supported.
- Transform and opacity only; height changes use `grid-template-rows`. Everything is instant under `prefers-reduced-motion`.

## Performance

- Studio photos: put full-size files in `assets/slideshow/` as `1.webp`, `2.webp`, ... and run `python scripts/optimize-images.py`. Pages only load the generated `web/` (1600px) and `thumb/` (720px) copies listed in `manifest.json`.
- Below-the-fold work (calendar, gallery, reviews, chat) starts when it is near the viewport or the browser is idle.

## Components (public)

- `.btn-primary` gold, `.btn-outline` hairline, `.btn-ghost` underlined text. One primary action per view.
- Form fields: label above, hint below, error below in `--danger`. Never placeholder-as-label.
- The booking form (`renderBookingForm` in `js/booking.js`) runs: when, add-ons, payment, your details. No account is needed; creating one or signing in is offered last, after the booking (and after the payment window).

## Dashboard

- Operate mode: one family, fixed scale, density over drama. Light and dark themes (system default, switch in the header).
- Every list: filter chips with live counts, a Sort menu (newest first by default), search, a table on wide screens and rows on narrow ones, and empty states that tell "nothing yet" from "nothing matches".
- Inside a panel, cards become ruled rows.
- Social graphics (`js/admin/pubmat/`): the layer engine and free-edit mode follow the Manson Pickleball maker, but the layouts are GGS's own: Statement, Big number, Waveform, Track list, Tape label, Quiet, Photo panel, Photo window, Photo column, Contact sheet, plus voucher, gift certificate and receipt. Each theme is one solid field plus one highlight; backgrounds are grid lines, ruled lines, a faint waveform, or flat. No halftone, blobs or gradients, and never two hues mixed in a background.
