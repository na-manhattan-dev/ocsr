# orgcs-remote

Keyboard shortcuts for the OrgCS console, and Omni-Channel status changes sent from another device through
Satella, the relay service Bellwood uses ([KiritoDv/Bellwood](https://github.com/KiritoDv/Bellwood),
`src/port/net`).

## Files

- `manifest.json`, `content.js`, `satella.js`: the Satellite extension that runs on the OrgCS page.
- `client/`: everything a linked device needs, so you can copy or host the folder as it is.
  - `remote.html`: OrgCS Remote, the web page for a phone or any browser.
  - `remote.js`: the same from a terminal, with Node 22 or later.
  - `satella.js`: the Satella client, a copy of the extension's.

The two copies of `satella.js` must stay the same, or the extension and your devices may stop
understanding each other. When you change one (for example the Satella address in `HOST`), copy it over
the other.

## Shortcuts

Every command is in the Extensions menu, in this order. You can change or remove any shortcut in
Settings > Shortcuts.

| Command | Default shortcut |
| --- | --- |
| Link a device | none (menu only) |
| Schedule statuses | none (menu only) |
| Show remote connection | none (menu only) |
| Close case tab | Ctrl+Opt+W |
| Refresh list view | Ctrl+Opt+R |
| Search this list | Ctrl+Opt+F |
| Omni-Channel: Available - Case | Ctrl+Opt+1 |
| Omni-Channel: Available - Voice | Ctrl+Opt+2 |
| Omni-Channel: Break | Ctrl+Opt+3 |
| Omni-Channel: Lunch | Ctrl+Opt+4 |
| Omni-Channel: Meeting | Ctrl+Opt+5 |
| Omni-Channel: Offline | Ctrl+Opt+0 |

- Satellite allows 12 commands per extension, and these are 12. So the statuses without a shortcut
  (Research, Screen Sharing, Project / Pilot Support, Training / Coaching, End of Work) have no command.
  Set them from the Omni-Channel menu, a schedule, OrgCS Remote or `remote.js`.
- If another command already uses a shortcut, Satellite doesn't grant it. The command stays in the menu
  and the conflict shows up in Settings > Extensions > Logs.
- Status commands open the Omni-Channel status menu and pick the matching entry. If your org renames a
  status, change its `label` in `OMNI_STATUSES` at the top of `content.js`.
- Refresh and search act on the list view on screen. When the split view is open next to a case, they
  prefer the main list.

## Scheduled statuses

**Extensions > Schedule statuses** opens a panel of time windows that set your Omni-Channel status, for
example Mon–Fri 12:00–13:00 Lunch. Each window has:

- the days it runs, a start time and, optionally, an end time
- the status during the window
- what happens when it ends: back to the **previous status** (the one before it started), **keep it**, or a
  status you pick

How they run:

- In your Mac's local time, while the OrgCS console with Omni-Channel is open in Satellite. With several
  OrgCS pages open, only one acts.
- A window's end always applies its **Afterwards** status, even if you changed the status yourself
  during the window, and even if Satellite opened after the window started (up to 15 minutes after it
  ended). **Previous status** is the one exception: it needs the window's start to have run that day.
- Back-to-back windows hand over without switching back in between: 9:00–12:00 Available - Case then
  12:00–13:00 Lunch goes Available, Lunch, then back to the status before 9:00.
- If Satellite opens partway through a window, the window still applies. A window without an end time,
  or the end of a window, still applies if Satellite opens up to 15 minutes late.
- A window can't cross midnight; split it in two.
- The panel shows what's next, e.g. `Next: Lunch at 12:00 today.` The windows are saved in the
  extension's storage.

## Remote status changes

The OrgCS page connects to `wss://sa-695a7ab59cca49a99418ac589afaded0.ecs.us-east-1.on.aws` with its own player key and listens on a private
relay channel. Anyone subscribed to a relay channel can write to it, so the page only acts on commands
whose sender key, as proven to Satella, is one of your **Linked devices**. Everyone links their own
devices to their own PC, so nobody has to set up anyone else's.

### Linking a device

1. On your PC, open the OrgCS console in Satellite and choose **Extensions > Link a device**. A panel
   shows an 8-digit code, e.g. `4821 9305`, for 5 minutes.
2. On the other device, type the code into **OrgCS Remote** (`client/remote.html`, below) and tap
   **Link**. Or, with Node 22 or later, copy the `client` folder and run `node remote.js link 4821 9305`
   in it.
   The PC adds the device under Settings > Extensions > orgcs-remote > **Linked devices**.
3. From then on, tap a status in OrgCS Remote, or run `node remote.js Break`. Either one shows what
   happened, e.g. `Omni-Channel: Break`.

- A code links one device. It stops working after 5 minutes, or after 3 wrong tries.
- To link more devices, choose **Link a device** again for each one.
- To unlink a device, delete its entry under **Linked devices**.
- The device only accepts answers from the PC it linked to.
- Commands from a device that isn't linked are ignored, and its key is written to the logs. Turning off
  **Accept remote status changes** closes the connection.

### OrgCS Remote (web page)

`client/remote.html` does what `remote.js` does, as a page for a phone or any browser: link with the
code once, then tap a status. The buttons come from your PC, so they always match `OMNI_STATUSES`.

- At the top it shows **Your status** now. It checks again every 15 seconds while the page is on screen,
  and as soon as you come back to it. `node remote.js status` prints the same.
- The PC reads your status from the Omni-Channel widget. If the widget doesn't show it, the PC knows it
  once a status is picked from the menu (by you, a schedule or a device); until then it says **Not known
  yet**.
- If the PC doesn't answer, the page says so and keeps checking.


- Serve the `client` folder (`remote.html` with `satella.js` next to it) over **https**. Browsers only
  make keys on secure pages, so a plain `http://` address on your network won't work. Opening the file
  from disk or `localhost` works on a computer.
- It needs a recent browser that can make Ed25519 keys (Safari 17, Chrome 137, Firefox 129 or later).
- The link and the device's key stay in that browser's storage. **Unlink** forgets both; delete the
  device under **Linked devices** on the PC too.
- One copy can serve everyone: each browser makes its own key and links to its owner's PC.

Without a code: `node remote.js setup <channel>` (the channel is under **Show remote connection**) prints
the device's key; paste it under **Linked devices**.

### Messages

On the channel `<channel>@1.0.0` (Bellwood's naming for a channel without a `mod_version`):

- command: `{"type":"set-status","status":"Break","id":"<any>"}`, or just the status as plain text, so a
  Bellwood mod can send it with `C_RelaySend("<channel>", "Break", 5)`
- reply from the page: `{"type":"status-result","id":"<same>","ok":true,"status":"Break","message":"Omni-Channel: Break"}`
- `{"type":"list-statuses","id":"<any>"}` from a linked device gets
  `{"type":"statuses","id":"<same>","statuses":["Available - Case", …],"current":"Lunch"}` (`current` is
  `""` when the PC can't tell)

Linking happens on the lobby `orgcs-remote.link.<first two digits of the code>@1.0.0`, which anyone can
listen to. So each side proves it knows the whole code, using HMAC-SHA256 keyed by the code over the
keys Satella proved (`SatellaClient.link` in `satella.js`):

- device: `{"type":"link-request","name":"<host name>","proof":"<hmac of request|device key>"}`
- page: `{"type":"link-result","to":"<device key>","ok":true,"channel":"<channel>","proof":"<hmac of accept|device key|page key|channel>"}`,
  or `"ok":false` with a `message` for a wrong code

Only status names, these replies and link messages go through Satella; no case data.
