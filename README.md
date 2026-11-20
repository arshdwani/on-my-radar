# On My Radar

Finals season as an approach-control radar scope, made into a countdown lock screen.
Live page: https://arshdwani.github.io/on-my-radar/

Six deadlines are six arrivals heading for one runway: you. Range rings are days. Each arrival's
distance from the runway is the number of days until it lands (the day it is submitted or the exam is sat).

## The rules
- **Separation:** no two landings within 48 hours; 72 hours behind a heavy one (`H/`), the way controllers leave
  extra space behind a heavy aircraft for its wake turbulence.
- **Conflict alert (CA):** two landings closer than the rule allows turn red.
- **Go-around:** untick a day you skipped and that arrival lands a day later; the scope re-checks separation.
- **Colours** follow the FAA national colour standard for terminal displays (JO 7210.3, 3-9-1): black background,
  dim gray range rings and compass rose, white data blocks for traffic you own (in progress), green for traffic you
  don't own yet (not started), blue history trails (the days already flown), yellow highlight (today), red warning.
- **Runway** = the day of the month of the last landing (Dec 18 → runway 18).

## The sample plan
A CS junior's finals, Nov 20 to Dec 18, 2026: ALGO PSET, ECON ESSAY, STAT REPORT, OS PROJECT (heavy),
PHYS FINAL (heavy, fixed), MATH FINAL (heavy, fixed). The official due dates put the OS project and the stats
report 24 hours apart; the plan slots the report 3 days early, on Dec 7, ahead of the OS project on Dec 9.
Landing slots, start days and one task per day were planned with Gemini.

## Use it
- **Download this day (PNG)**, **Every day (.zip)** and **Clearance reminders (.ics)** on the live page.
- iOS: put the unzipped `OnMyRadar` folder in iCloud Drive/Shortcuts, then Shortcuts → Automation → Time of Day
  (6:00 AM, daily, run immediately): Current Date → Format Date (`yyyy-MM-dd`) → Get File
  `OnMyRadar/[Formatted Date].png` → Set Wallpaper Photo (Lock Screen). Set Notifications → Display As: Count.
- **Your own deadlines:** one per line, `name, YYYY-MM-DD`, plus `H` (heavy) and `X` (exam, can't move), or import
  a calendar `.ics`. The sequencer tries every landing order and picks the one that pulls the least work earlier
  while keeping separation. Your plan lives in the URL and your browser only.

## Files
`radar.js` draws everything (lock screen, scope, exports) on a canvas. `plan.js` is the sample plan.
`app.js` is the page. `frame.html?date=YYYY-MM-DD&clock=1` renders one 1290×2796 frame (used for the PNGs).

## Credits
Type: B612 and B612 Mono, designed for Airbus cockpit displays (SIL Open Font License, `fonts/OFL-B612.txt`).
Code: MIT licence.
