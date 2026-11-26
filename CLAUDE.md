# Leakvue: notes for Claude

## What this is

A companion app for **LeakVue**, American Leak Detection's laser water-level tester for pools, spas and fountains. It's built for **one ALD franchise** (the repo owner) and is used by their techs on **iPhone and iPad**. The owner is not a developer: explain Xcode/Apple steps one click at a time, and ask before anything that costs money or touches their Apple account.

The official LeakVue app has hard-to-read graphs and nothing a homeowner can understand. This app runs the same test and explains it:

- A LeakVue test is a **15-minute scan** (the tech can change the length) with the **pump ON**, then the same with the **pump OFF**, comparing the loss rates.
- After the leak is located, the tech **isolates** a line (plugs returns, main drain, etc.) and **rescans** to see if that was the whole leak or if there's a second one.
- The app turns the readings into gallons (from the pool's surface area), splits loss into normal evaporation vs. leak, explains pump ON vs OFF in plain English, and builds a homeowner report of phone-sized cards meant to be screenshotted and texted.

See README.md for the user-facing description and file map.

## How it's built (keep it this way)

- Plain HTML/CSS/JS, **no build step, no bundler, no framework**. Classic `<script>` tags in `index.html`, all code under `window.LV`. It must keep working when served as static files (GitHub Pages) and opened from disk.
- Storage: IndexedDB via `js/db.js` (stores `tests`, `settings`). Backups are JSON export/import.
- All math lives in `js/calc.js` (pure, Node-testable). Run `node tests/calc.test.js` after touching it.
- Homeowner wording lives in `js/catalog.js` and `js/story.js`, so the tech screen and report always say the same thing.
- Charts are hand-written HTML/SVG in `js/charts.js`. Colours were validated for colour-blind safety: blue `#257de0` = leak, gray `#8893a0` = normal evaporation. Keep those meanings.
- The report (`js/views/report.js`) is always light, and each card should fit one phone screen (about 650–700 px tall at 390 px wide).
- When you add or rename a JS file, update the `<script>` list in `index.html` and the `ASSETS` list in `sw.js`, and bump `VERSION` in `sw.js`.

## The readings contract (where Bluetooth plugs in)

A scan is an object in `test.scans[]` (see `LV.model.newScan` in `js/views/tests.js`):

```js
{ id, pump: 'on'|'off', purpose: 'baseline'|'isolation', isolated, compareTo,
  durationMin, dropIn,          // manual entry (inches), used when there are no readings
  readings: [[secondsSinceStart, levelInches], ...] | null,
  timerStartedAt }
```

If `readings` has 3 or more points, `LV.calc.scanRate` ignores `dropIn` and fits a least-squares trend line. The tech screen then shows "From LeakVue readings" and a level graph, and the report gets the graph card. **Level is in inches, and higher = more water.** Convert whatever the device sends into that before storing. Everything downstream already works; the sample test in `LV.model.sampleTest` uses simulated readings in exactly this shape.

## Current milestone: native iPhone/iPad app + LeakVue 2 over Bluetooth

Safari can't use Bluetooth, so the web app gets wrapped as a native app. The owner has a Mac with Xcode, an iPhone and an iPad, and both a **LeakVue 1** (discontinued, no longer updated) and a **LeakVue 2**. The LeakVue 2 uses Bluetooth; the LeakVue 1's connection type is unknown.

### Phase 1: native wrapper
- Use **Capacitor** with the iOS platform, universal iPhone + iPad. Keep the web files where they are and add a small copy step (e.g. an npm script) that puts `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest` into the Capacitor `webDir`, so GitHub Pages keeps working unchanged.
- Add `NSBluetoothAlwaysUsageDescription` to Info.plist (e.g. "Leakvue connects to your LeakVue sensor to read the water level.").
- Ask the owner for the bundle ID and app display name before creating the project.
- Get it running on the owner's own iPhone from Xcode. A free Apple ID "Personal Team" is fine for now (the build expires after 7 days; just re-run it). Bluetooth does **not** work in the iOS Simulator, so use the real phone.
- Walk the owner through: signing in to Xcode with their Apple ID, plugging in the phone and tapping Trust, and turning on Developer Mode (iPhone Settings → Privacy & Security).

### Phase 2: Device Lab (find out what the LeakVue 2 sends)
Add a **Device Lab** screen, shown only inside the native app, using `@capacitor-community/bluetooth-le`. There's no bundler, so call the native plugin through `window.Capacitor.Plugins` (or add the smallest build step that works, without breaking the static web version). It should:
- Scan and list nearby devices (name, id, signal strength).
- Connect, then list every service and characteristic with its properties.
- Read anything readable, and subscribe to everything that notifies or indicates.
- Log each value with a timestamp as hex, alongside trial decodings (int16/uint16/int32/uint32/float32 in both byte orders, plus ASCII).
- Have a **Share log** button (iOS share sheet) so the owner can AirDrop the log to the Mac for you to read.

Then have the owner capture logs: device idle in still water; a hand gently raising and lowering the water near the sensor; and, if practical, a little water drained. Correlate the values to find the level characteristic, its units and scale, and its sample rate.
- **Don't try to get around security.** If the data is encrypted, needs bonding with a secret, or needs commands you can only get by attacking the official app, stop and tell the owner. The right path then is asking ALD / PlainSight for the protocol.
- Also try the LeakVue 1 and report what you see. If it doesn't appear in a BLE scan, it may use classic Bluetooth, which iOS apps generally can't reach without Apple's MFi program.

### Phase 3: live scans
- On the test screen add **Connect LeakVue**. During a scan, stream readings into `scan.readings` as `[secondsSinceStart, levelInches]`, update the level graph and the running rate live, and stop when the scan timer ends.
- Keep manual entry as the fallback whenever no device is connected.
- Save readings as they arrive, so a crash or a phone call doesn't lose a scan.

### Phase 4: getting it to the techs
- Install on the other techs' iPhones/iPads through **TestFlight**. That needs the paid Apple Developer Program ($99/year): explain it and let the owner decide. Private, franchise-only distribution is fine; this app isn't meant for the public App Store.

## Ground rules
- Commit on a branch and push; don't commit customer data, Apple certificates or keys.
- Keep the homeowner wording plain and friendly. Read `js/catalog.js` before changing it.
- Test the math with `node tests/calc.test.js`, and check UI changes in the browser (or on the device) at phone width before calling them done.
