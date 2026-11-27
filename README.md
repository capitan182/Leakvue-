# Leakvue

A better companion app for **LeakVue** pool, spa and fountain leak tests, built for one American Leak Detection franchise.

The current LeakVue app shows a graph that's hard for a homeowner to follow and gives you nothing you can hand over. Leakvue takes the same test (pump ON scan, pump OFF scan, then rescans after you isolate lines) and turns it into:

- **Gallons.** Enter the pool size once and every scan is converted from inches to gallons a day, a month, and bathtubs. You can also show a dollar cost.
- **A plain-English answer.** It compares pump ON with pump OFF and explains what that points to:
  - leaks more with the pump running → pressure side (return lines or equipment)
  - leaks more with the pump off → suction side (skimmer or main drain lines)
  - about the same either way → the pool structure (light, fittings, shell)
- **Rescan results.** "With the return lines isolated, the pool stopped losing more than normal evaporation. That was the leak", or "it still loses 90 gallons a day, so there's likely a second leak."
- **A homeowner report made of phone-sized cards.** Each card makes sense on its own when screenshotted and texted. You can also print or save the whole report as a PDF.

## How a test works in the app

1. **New test.** Enter the pool size (rectangle, oval, round, kidney, or a known surface area, plus an attached spa). No customer details are asked for; the technician name is remembered on each device after the first time it is typed.
2. **Conditions.** Set normal evaporation for the day (default 0.25 in/day; raise it for hot, dry or windy days). Confirm auto-fill is off.
3. **+ Pump ON scan.** Tap **Start 15:00 timer**; it chimes when the scan is done. Enter the water drop from LeakVue in inches.
4. **+ Pump OFF scan.** Same again.
5. **+ Rescan after isolating.** Say what you isolated (main drain, return lines, light niche…), run the scan, and enter the drop. Repeat for a second leak.
6. **Report.** Screenshot the cards for the homeowner, or use Print / Save PDF.

The **Results** box on the test screen updates live as you enter numbers. If you disagree with the automatic diagnosis you can override it, and anything you type in **Message to the homeowner** appears on the report under "Next steps".

Tap **See a sample report** on the start screen to try a finished test with simulated readings.

## The LeakVue device (Bluetooth): finding out what it sends

For now the tech types the water drop from the LeakVue app into Leakvue. Reading the LeakVue 2 directly is under way:

1. **Done:** Leakvue is packaged as a real iPhone/iPad app (Apple doesn't let web pages use Bluetooth). [IPHONE.md](IPHONE.md) walks through installing it from a Mac, click by click.
2. **Done:** the app has a **Lab** screen that scans for the LeakVue, connects, shows everything it sends, and records a log you can AirDrop to the Mac. It listens, and only asks the device for anything when you tap a button that says so.
3. **Next:** capture logs from a real LeakVue 2 to work out which value is the water level.
4. **Then:** a Connect LeakVue button on the test screen that fills in the readings live. The level graph and trend-line math are already built and tested on simulated readings.

## Running it

**On phones and iPads:** in this repository go to *Settings → Pages*, choose *Deploy from a branch*, pick the branch and `/ (root)`, and save. Open the link on the iPhone/iPad and use *Share → Add to Home Screen*. It then opens like an app and works with no signal.

**On a computer:** double-click `index.html`, or run `python3 -m http.server 8000` and open http://localhost:8000.

## Where data lives

Tests are stored in the browser on each device (IndexedDB). Nothing is uploaded. Use **Settings → Export backup** regularly and **Import backup** to move tests to another device. Clearing Safari's website data deletes the tests.

## Customizing

- Wording for the pump ON/OFF explanations, isolation suggestions, pool shapes and default fine print: [`js/catalog.js`](js/catalog.js)
- Math (surface area, gallons per inch, trend line, diagnosis rules): [`js/calc.js`](js/calc.js). Run `node tests/calc.test.js` after changing it.
- Leak margin, default evaporation, scan length and water cost: in the app under **Settings → Test defaults**.
- After publishing changes, bump `VERSION` in [`sw.js`](sw.js) so installed copies update.

## Files

```
index.html            app shell
css/app.css           styles (screen, dark mode, always-light report, print)
js/util.js            HTML templating, dates, small helpers
js/calc.js            all the math (no UI), unit-tested in tests/calc.test.js
js/decode.js          Bluetooth bytes as hex and trial numbers, unit-tested in tests/decode.test.js
js/native.js          bridge to the iPhone app: Bluetooth, share sheet, keep screen on
js/catalog.js         pick lists, homeowner wording, defaults
js/db.js              on-device storage, test numbers, backup/restore
js/form.js            form fields bound to the test/settings data
js/story.js           turns results into plain-English sentences
js/charts.js          loss bars, water-level graph, pool wall figure
js/views/tests.js     test list, new/sample test
js/views/test.js      tech screen: pool, scans, timer, live results
js/views/report.js    homeowner report cards
js/report-images.js   "Save pictures": each report card as a PNG (for Photos / ServiceTitan)
js/vendor/            html2canvas 1.4.1 (MIT), loaded only when pictures are made
js/views/settings.js  company details, test defaults, backup
js/views/lab.js       Device Lab (iPhone app only): scan, connect, log, share
js/app.js             router and startup
sw.js                 offline cache (web version only)

package.json          iPhone app tooling (Capacitor); the web app itself needs none of it
capacitor.config.json app ID and name for the iPhone app
scripts/copy-web.js   copies the web files into www/ for the iPhone app
ios/                  the Xcode project
IPHONE.md             how to install the app on an iPhone from a Mac
```
