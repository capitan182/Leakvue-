# Leakvue

Leakvue is a field report app for leak detection technicians. On the job you log the customer and property, the detection methods and tests you ran, and every leak you located with photos. The customer signs on screen, and Leakvue produces a clean, branded report you can print or save as a PDF to email.

It's a plain web app: no account, no server, no build step. It runs in any modern browser on a phone, tablet or laptop, and keeps working without a signal once it has loaded.

## What it does

- **Jobs list**: search by customer, address or job number, and filter by status (Scheduled, In progress, Completed).
- **Job editor**: every change saves automatically on the device.
  - Job: status, service type, date, arrival time, technician
  - Customer & property, with one-tap **Call** and **Open in Maps**
  - Reason for call (the customer's concern)
  - Detection methods: acoustic, thermal, pressure test, line isolation, meter/flow test, tracer gas, camera, moisture, dye, bucket test, visual
  - Tests & readings: meter checks, pressure tests, dye or bucket tests, each with an outcome
  - Findings: one card per leak, with location, system, severity, the method used to locate it, whether it was marked on site, details and photos
  - Overall result: *Leak located*, *No leak detected* or *Further testing recommended*
  - Recommendations, site photos, customer signature, and internal notes (left off the report)
- **Customer report**: company header with your logo, a result banner, findings with photos, a tests table, recommendations, your terms, and signatures. Use **Print / Save PDF**. The PDF file name defaults to the job number and customer name.
- **Settings**: company name, location line, phone, email, website, license #, logo, job number prefix, default technician, and the terms text printed on every report.
- **Backup**: export everything (jobs, photos, settings) to a `.json` file, and import it on another device.

## Running it

**Easiest: GitHub Pages.** In this repository go to *Settings → Pages*, set *Source* to *Deploy from a branch*, pick the branch and `/ (root)`, and save. Open the URL GitHub gives you on your phone and use *Add to Home Screen* (Share menu on iPhone, ⋮ menu on Android). It then opens like an app and works offline.

**On a computer:** double-click `index.html`. Offline caching and "install as app" need the app served over `https://` (as on GitHub Pages) or from `localhost`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Where your data lives

Jobs, photos and settings are stored **in the browser on that device** (IndexedDB). Nothing is uploaded anywhere. That means:

- Each phone or computer has its own set of jobs. Use **Settings → Export backup** and **Import backup** to move them between devices.
- Clearing the browser's site data deletes your jobs. **Export a backup regularly.**
- Photos are resized to 1600 px on the long edge to keep storage small. A job with 10 photos is typically 2–4 MB.

## Customizing

- **Pick lists** (service types, property types, methods, systems, suggested tests) and the default terms text are in [`js/catalog.js`](js/catalog.js).
- **Colors** are CSS variables at the top of [`css/app.css`](css/app.css). The report always prints in light colors.
- After you change any file and publish it, bump `VERSION` in [`sw.js`](sw.js) so installed copies pick up the update on their next launch.

## Project layout

```
index.html            app shell
css/app.css           styles (screen, dark mode, print)
js/util.js            HTML escaping/templating, dates, helpers
js/catalog.js         pick lists and default settings
js/db.js              IndexedDB storage, job numbering, backup/restore
js/form.js            form fields bound to job/settings objects
js/photos.js          photo resize, photo grid, lightbox
js/signature.js       signature pad
js/views/jobs.js      job list + new job
js/views/job.js       job editor
js/views/report.js    printable customer report
js/views/settings.js  settings, backup, erase
js/app.js             router and startup
sw.js                 offline cache
manifest.webmanifest  install-as-app metadata
```

Plain JavaScript loaded with ordinary `<script>` tags (no modules), so the app also runs when opened straight from disk.
