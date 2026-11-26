# Learning how the LeakVue 2 talks

The LeakVue 2 won't send readings until its own app tells it to start, and it never answers a plain
"read". The official app clearly knows the magic words. Since this is your own device and American
Leak Detection won't share the protocol, the plan is to **watch the official app's own conversation
with the device** and copy what works. Nothing here changes or attacks the official app; we only
record Bluetooth traffic between two things you own.

There are two experiments. Do **A** first (no new tools). **B** is what actually gets the "start"
command, and needs a free Apple tool on the Mac.

---

## Experiment A: listen in while the official app runs a test

This may hand us the **format of the readings** for free. It can't get the start command, but it's
quick and needs nothing new.

1. Update the app and reinstall (adds a "LeakVue app already running?" button):

```bash
cd ~/Leakvue && git pull && npm install && npm run ios
```

Press **▶** in Xcode.

2. On the **same iPhone**, open the **official LeakVue app** and start a normal test: connect to the
   scanner, let it level out, and hit go, exactly as you always do. Leave it running.
3. Switch to our app (don't close the official one). Tap **Lab**.
4. Tap **LeakVue app already running?**, then **Find the connected LeakVue**.
5. The device appears tagged "already connected (another app)". Tap **Connect** on it.
6. **Don't** tap "Tell the device we're ready" this time — let the official app drive. Just watch box
   **C19 (Serial data from the device)** for the length of a real test.
7. Tap **Share log** and send it to me.

- If **C19 fills with changing numbers** while the official app runs: we've captured the readings
  format. Then do it again doing the water moves (still → hand raising/lowering → draining), so I can
  match numbers to water level.
- If **C19 stays empty**: iOS isn't sharing the stream with our app. No problem — go to Experiment B.

---

## Experiment B: record the conversation (gets the start command)

This captures every byte the official app sends the device, including the "start" command. It uses
**PacketLogger**, a free Apple tool.

### One-time setup

1. **Get PacketLogger.** On the Mac, open Safari to `developer.apple.com/download/all`, sign in with
   your Apple ID (the same free one). In the search box type **Additional Tools for Xcode**. Download
   the newest one (e.g. "Additional Tools for Xcode 26"). Open the downloaded `.dmg`, open the
   **Hardware** folder, and drag **PacketLogger** into **Applications**.
2. **Turn on Bluetooth logging on the iPhone.** In Safari on the Mac, open
   `developer.apple.com/bug-reporting/profiles-and-logs/` and find **Bluetooth**. Download its profile
   to the iPhone (easiest: AirDrop the downloaded file to the iPhone, or open that page on the iPhone
   itself and download there). On the iPhone: **Settings → General → VPN & Device Management →** tap
   the **Bluetooth** profile → **Install** (enter your passcode). Then **restart the iPhone**.

Send me a screenshot at any step that doesn't look like this and I'll steer you.

### Each capture

1. Plug the iPhone into the Mac with its cable and unlock it.
2. Open **PacketLogger** (in Applications). From the menu bar choose **File → New iOS Trace** (or open
   **Window → Devices**, pick your iPhone, and press record). A live list of Bluetooth packets starts
   filling.
3. On the iPhone, open the **official LeakVue app** and run **one** normal test, start to finish.
4. Back in PacketLogger, press **Stop** (the square), then **File → Save As…** and save it to the
   **Desktop** with a name like `leakvue-capture.pklg`.
5. Send me that `.pklg` file.

I'll read out the start command and the readings format from it, and build the real **Connect
LeakVue** button so our app can run scans by itself.

### If you'd rather not use PacketLogger

- **An Android phone/tablet** with the official app is actually easier: Settings → Developer Options →
  turn on **Bluetooth HCI snoop log**, run one test, turn it off, and send me the log. Tell me if you
  have one and I'll give the exact steps.
- A **$10 nRF52840 USB sniffer** with Wireshark is the most reliable but means buying hardware. Ask me
  if the above doesn't pan out.
