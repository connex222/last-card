# Last Card

A colour-matching party card game. The **TV shows the table**, and every player uses **their own phone as their hand**. Up to 10 players.

You can run it two ways, with the same code:

| | On a laptop | Online (Render, free) |
|---|---|---|
| Needs internet | No | Yes |
| Phones must be on the same Wi-Fi | Yes | No |
| Setup on the night | Double-click `start.bat` | None, just open the website |
| First load | Instant | Up to a minute if nobody has played for 15 minutes |

## First-time setup (once only)

1. **Install Node.js.** Go to **nodejs.org**, download the version marked **LTS**, and run the installer, clicking Next through every screen. This is the only download you need, and the game's other parts are already in the folder.
2. **Unzip the `last-card` folder** somewhere easy to find, such as your Desktop.

## Starting a game night

1. **Connect the laptop to the TV.** Use an HDMI cable, or cast the browser tab to the TV.
2. **Double-click `start.bat`** in the `last-card` folder. On a Mac, double-click `start.command` instead.
3. A black window opens. **Leave it open**, because closing it stops the game.
4. The first time, Windows Firewall asks about Node.js. Tick **Private networks** and click **Allow**. If you skip this, phones can't connect.
5. The TV page opens in the browser by itself. If it doesn't, type `localhost:3000/tv.html` into the browser.
6. Press **F11** to make the browser full screen.
7. Players **scan the QR code** with their phone camera, type their name, pick an avatar and tap **Join game**.
8. Once two or more players have joined, press **Deal the cards** on the TV. The first player to join can also start from their phone.

## How to play

On your turn, play a card that matches the **colour** or the **number or symbol** on the pile. You can play a Wild at any time. If you have no card that matches, tap **Draw card**. If the card you draw can be played, you can play it straight away or tap **Keep card**.

| Card | What it does |
|---|---|
| **Skip** | The next player misses their turn. |
| **Reverse** | Play changes direction. With only 2 players it works like a Skip. |
| **Draw Two** | The next player picks up 2 cards and misses their turn. |
| **Wild** | You choose the next colour. |
| **Wild Draw Four** | You choose the next colour, and the next player picks up 4 and misses their turn. You may only play it when you hold **no cards of the current colour**. |

**Last Card!** When you're down to one card, tap **LAST CARD!** You can also tap it just before playing your second-to-last card. If you forget and the next player takes their turn before you call it, you pick up 2 cards.

The first player to empty their hand wins the round, and the TV keeps a tally of wins.

## Putting it online for free

You do this once. It takes about 15 minutes.

### Part 1: put the code on GitHub

1. Sign in at **github.com**.
2. Click the **+** at the top right, then **New repository**.
3. Name it `last-card`. Choose **Private** if you don't want others to see the code. Leave everything else as it is, then click **Create repository**.
4. On the next page, click the link that says **uploading an existing file**.
5. Open the `last-card-repo` folder on your computer and select **everything inside it**: the files and the `game`, `public`, `src` and `test` folders. Drag them all onto the GitHub page. Use Chrome or Edge, because they let you drag folders.
6. Wait for the uploads to finish, then click **Commit changes**.

### Part 2: run it on Render

1. Go to **render.com** and click **Get Started**. Choose **GitHub** to sign up, and allow Render to see your repositories.
2. Click **+ New**, then **Web Service**, then choose your `last-card` repository.
3. Fill in these boxes. Leave anything not listed as it is.

| Box | Type this |
|---|---|
| Name | `last-card` (this becomes your web address, so pick another name if it's taken) |
| Language | `Node` |
| Build Command | `npm install --omit=dev` |
| Start Command | `node server.js` |
| Instance Type | **Free** |

4. Click **Deploy Web Service** and wait until the status at the top says **Live**. The first time takes a few minutes.
5. Your address appears at the top left, for example `https://last-card.onrender.com`.

### Playing online

- **On the TV:** open your address with `/tv.html` on the end, for example `https://last-card.onrender.com/tv.html`.
- **On phones:** scan the QR code. Phones can be on any Wi-Fi or on mobile data.
- **If the page is slow to appear,** the free server was asleep. Give it up to a minute, and it stays awake while you play.

### Updating it later

Upload the changed files to the same GitHub repository using **Add file**, then **Upload files**, then **Commit changes**. Render notices the change and updates the website by itself within a few minutes.

## Sharing the laptop version

To let others download the ready-to-run zip, open your GitHub repository and click **Releases**, then **Create a new release**. Type a tag such as `v1.0.0`, drag `last-card.zip` into the box at the bottom, then click **Publish release**. Anyone you share the release link with can download it.

## If something goes wrong

| Problem | Fix |
|---|---|
| A phone can't load the page | Make sure the phone is on the **same Wi-Fi** as the laptop and not on mobile data. Guest Wi-Fi networks often block devices from seeing each other, so use the main network. |
| It still won't connect | You probably blocked the firewall prompt. Open **Windows Security**, then **Firewall & network protection**, then **Allow an app through firewall**, and tick **Node.js** for Private networks. |
| A phone goes to sleep | Unlock it, and it rejoins in the same seat with the same cards. If a sleeping player's turn comes up, the game waits 20 seconds, then draws a card for them and moves on. |
| Someone leaves for good | Click their name on the TV to remove them. Their cards go back in the deck. |
| "Port 3000 is already in use" | The game is already running in another black window. Use that one, or close it and start again. |
| The TV page refreshed | Nothing is lost. The same room comes back with the same code. |
| Online: the game ended suddenly | The free server occasionally restarts. Refresh the TV page to get a new room code, and everyone scans again. |
| Online: Render says the build failed | Check that the Build Command and Start Command match the table above exactly. |

## For tinkering

- `server.js` handles rooms, the lobby, and sending the right information to each screen.
- `game/lastcard.js` holds all the game rules.
- `public/tv.html` and `public/js/tv.js` are the TV screen.
- `public/phone.html` and `public/js/phone.js` are the phone controller.
- `public/js/cards.js` draws the cards and is shared by the TV and the phones.
- `src/input.css` contains the shared design system: colours, cards and buttons.

**Changing the look:** the styles are pre-built into `public/css/app.css` so the game works offline. After editing `src/input.css` or adding new Tailwind classes, run `npm install` once (this needs internet), then run `npm run build:css`.

**Testing:** `npm test` plays 2,000 random games against the rules and checks that no card is ever lost. It then plays a full round over the network against the real server. This also needs `npm install` first.

**Changing the port:** set `PORT=4000` before starting the server.

**Forcing the QR address:** the QR code normally follows whatever address the TV page was opened on. To override it, set `PUBLIC_URL`, for example `https://cards.example.com`.
