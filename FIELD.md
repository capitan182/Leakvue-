# Recording a real job

Run our app **alongside** the ALD LeakVue app on a real leak job. The ALD app does the test exactly as
always; our app quietly records what the LeakVue sends. Afterwards we line up the ALD app's numbers
with our recording. A few real jobs give us the exact inches conversion, and show whether our app's
results match theirs.

The ALD app stays your tool for the customer. Our app only listens.

## Before the job

Update the app (only when Claude has said there's a change):

```bash
lv
```

Press **▶** in Xcode with the phone plugged in.

## At the pool

1. Set up the LeakVue as normal. In the **ALD app**, connect and start the scan.
2. Switch to **our app → Lab**. Tap **LeakVue app already running? → Find the connected LeakVue → Connect**.
3. Check box **C19** is ticking (the "Change since connect" number moves a little, the packet number counts up).
4. Tap the markers as things happen: **ALD scan started**, **Pump ON**, **Pump OFF**, **Isolated a line**,
   **ALD scan finished**.
5. Whenever the ALD app shows a result, type it in the note box exactly as shown, e.g. `pump on -0.14in -78gal -0.89px`.
   If there's a **px** number, include it: that one matters most.
6. Take a normal iPhone **screenshot** of the ALD results screen (side button + volume up), then tap
   **Took a screenshot**.

Every note saves the LeakVue reading at that moment, so we know exactly where the ALD numbers fit.

**Stay on our Lab screen as much as you can during the scan**, and do the ALD reading/screenshots at the
end. Our app should keep listening in the background, but the line under the reading shows
**"N dropped"** if it missed anything. If that number climbs whenever you switch away, tell Claude.

If the ALD app's result looks odd on a job where you ran ours too, do the job again in the ALD app alone.
Better a repeat scan than a wrong number for a customer.

## After the job (do this right away)

1. In our Lab, tap **Share log → AirDrop →** your Mac. Quitting our app clears the log, so share first.
2. In **Photos**, select the ALD screenshots and share them to your Mac too (sharing from Photos keeps
   the time they were taken, which is how we line them up).
3. Send Claude the log and the screenshots, plus anything you know about the pool: size, roughly how bad
   the leak was, what you isolated, what you found.

One good job with a real leak, pump on and pump off, is worth more than any amount of bench testing.
