# Putting Leakvue on your iPhone

This gets the app onto your own iPhone (or iPad) from your Mac, with the **Lab** screen that shows what the LeakVue sends over Bluetooth.

**Cost: nothing.** A free Apple ID is enough. The one catch with the free route: the app stops opening after 7 days, and you press Play in Xcode again to renew it. Nothing here asks for a card. If Xcode ever offers to *enroll* or *join the Apple Developer Program* ($99/year), close that; it's only needed later for TestFlight.

## What you need

- A Mac with **Xcode 26 or newer** (free, from the Mac App Store). Open it once and let it finish installing its extra components.
- Your iPhone and its cable.
- Your Apple ID and password.

## 1. One-time setup on the Mac

1. Install **Node.js**: go to nodejs.org, download the **LTS** installer for macOS, open it and click through. (Free. It's the tool that assembles the app.)
2. Open **Terminal** (press ⌘-Space, type `Terminal`, press Return).
3. Paste these one at a time, pressing Return after each:

```bash
git clone https://github.com/capitan182/Leakvue- ~/Leakvue
```

```bash
cd ~/Leakvue && git checkout claude/clever-curie-5dhyyo
```

```bash
npm install
```

```bash
npm run ios
```

The last one opens the project in Xcode. If the first one asks for a GitHub username and password, sign in with your GitHub account.

## 2. Sign in to Xcode (once)

1. In the menu bar: **Xcode → Settings… → Accounts** (the tab may be called *Apple Accounts*).
2. Click **+** at the bottom left, choose **Apple Account**, and sign in with your Apple ID.
3. Close the Settings window.

## 3. Tell Xcode the app is yours (once)

1. In the left sidebar click the blue **App** icon at the very top.
2. In the middle, under **TARGETS**, click **App**.
3. Click the **Signing & Capabilities** tab.
4. Make sure **Automatically manage signing** is ticked.
5. Next to **Team**, pick your name followed by **(Personal Team)**.

A red message here that mentions the *bundle identifier* is the one thing to stop on. Copy it and send it to Claude.

## 4. Get the iPhone ready (once)

1. Plug the iPhone into the Mac and unlock it.
2. On the iPhone tap **Trust**, then type your passcode. On the Mac, click **Allow** if asked.
3. On the iPhone: **Settings → Privacy & Security → Developer Mode** (near the bottom), switch it **on**, and tap **Restart**. After it restarts, unlock it and tap **Turn On**.
   *Developer Mode only appears after the phone has been plugged in with Xcode open. If it's missing, leave it plugged in for a minute and look again.*

## 5. Run it

1. At the top middle of the Xcode window there's a bar that says **App ›** and a device name. Click the device name and pick **your iPhone** from the list (not one of the simulators; Bluetooth doesn't work in those).
2. Press the **▶ Play** button at the top left.
3. The first time takes several minutes while Xcode downloads what it needs. If the Mac asks for your password to use a "key", type your Mac password and click **Always Allow**.
4. The first launch is blocked with **Untrusted Developer**. On the iPhone: **Settings → General → VPN & Device Management →** tap your Apple ID under *Developer App* **→ Trust**. Then press **▶** again, or tap the app icon.

You should see Leakvue with **Tests**, **Settings** and **Lab** across the top.

## 6. Capture what the LeakVue 2 sends

Do this with the LeakVue 2 switched on and its sensor in water. Close the official LeakVue app first (swipe it away) so it isn't holding the connection.

1. Open the app and tap **Lab**.
2. Tap **Start scan**. Tap **Allow** when the iPhone asks about Bluetooth.
3. Hold the phone next to the LeakVue. The strongest signal is listed first. Tap **Connect** on it.
4. Wait for section 2 to fill in. Each box (C1, C2, …) is one thing the device can tell us.
5. Record three short captures. Tap the matching note button **right before** each one:
   - **Idle: sensor in still water**, then leave everything alone for 2 minutes.
   - **Hand raising and lowering the water**, then slowly push water toward the sensor and let it fall back for 1 minute.
   - **Draining a little water** (only if it's easy), then **Stopped / water settling** once you stop.
6. Tap **Share log → AirDrop →** your Mac. The file lands in the Mac's **Downloads** folder, named `leakvue-device-log-….txt`.
7. Give that file to Claude.

The screen stays on while the Lab is open. Leave the app on the Lab screen during a capture.

Then try the **LeakVue 1** the same way. If it never appears in the scan list, note that; it probably uses the older kind of Bluetooth that iPhone apps can't reach.

## After changes to the app

When Claude changes the app, update the copy on your phone from Terminal:

```bash
cd ~/Leakvue && git pull && npm install && npm run ios
```

Then press **▶** in Xcode again. That's also how you renew the app after the 7 days are up (just press **▶**).
