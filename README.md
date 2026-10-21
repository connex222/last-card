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

## Choosing a game

The lobby on the TV shows every game in the Last Card family. Click a game, or use the **left and right arrow keys**. The first player to join can also choose from their phone.

| Game | What's different |
|---|---|
| **Classic** | The rules above. |
| **Solo** | One person against 1 to 5 computer players, with Classic rules. |
| **Pile-Up** | Stacking and hand-swapping. See below. |
| **Tag Team** | Play in teams. See below. |
| **Hot Potato** | Bomb cards and a hidden fuse. See below. |
| **Eclipse** | A double-sided deck that flips between Day and Night. See below. |
| **Frenzy** | No turns at all. The fastest matching card wins. See below. |

### Pile-Up

- **Stacking:** when a **+2** is played on you, you can answer with any **+2** of your own instead of picking up. The total passes to the next player and keeps growing. **+4** works the same way, but only on another **+4**. Whoever can't answer, or doesn't want to, taps **Take** and picks up the whole stack, then misses their turn. The TV shows the running total in a red circle on the pile.
- **7 swaps hands:** play a 7 and your phone asks who to swap with. You get their cards, and they get yours.
- **0 passes everyone's hand on:** every player passes their whole hand to the next player, in the direction of play.
- If a swap leaves you with one card, you're counted as having called Last Card, so nobody is caught out by a hand they were just given.

### Tag Team

- Choose **Pairs** or **Threes** in the lobby. Teams are drawn at random when you deal, and partners are seated apart, so turns go team to team.
- **Either partner emptying their hand wins it for the whole team**, and everyone on the team gets the win.
- Your phone shows your team, and your partners are marked in the row of players.
- **Signals:** tap **I've got…** and a colour, **Hold back**, or **Help!** Only your partners' phones see what you sent. The TV shows a speech bubble over your seat but never the message.
- You need enough players to make equal teams of at least 2 teams. The TV tells you if the numbers don't work, and computer players can make them up. Computer players try not to skip or hit their own partner.

### Hot Potato

- The deck has **4 Bomb cards**, one in each colour. A Bomb is played like any other card: match its colour, or play it on another Bomb.
- **Playing a Bomb lights a fuse of secret length**, somewhere between 20 seconds and a minute. A spark races round the table rim, and the table glows hotter the longer it burns. Nobody, not even the TV, shows when it will blow.
- **While the fuse burns, every turn has 5 seconds.** A ring counts down round the player's seat, a bar counts down on their phone, and Android phones tick for the last 3 seconds. Run out of time and you draw 1 card and your turn is over.
- **Whoever's turn it is when it blows draws 4.** The fuse then goes out until the next Bomb.
- Playing a Bomb while the fuse is already burning **re-lights it with a new secret length**, which could be shorter.

### Eclipse

Every card has a **Day face** and a **Night face**, and the game starts on Day. Nobody can see the other side of any card, not even their own.

| | Day side | Night side |
|---|---|---|
| **Colours** | Red, Yellow, Green, Blue | Violet ◆, Teal ✚, Pink ♥, Orange ✦ |
| **Look** | Bright cards on a sunlit table | Dark cards glowing like neon on a starry table |
| **Numbers** | 1 to 9 | 1 to 9 |
| **Hit cards** | **+1**: next player draws 1 and misses a turn | **+5**: next player draws 5 and misses a turn |
| **Skips** | **Skip**: the next player misses a turn | **Skip Everyone**: everybody misses a turn, so you go again |
| **Wilds** | **Wild**, and **Wild +2** (choose a colour, next player draws 2 and misses a turn) | **Wild**, and **Wild Draw Until** (choose a colour, the next player keeps drawing until that colour turns up, up to 10 cards, then misses a turn) |
| **Both sides** | **Reverse** and **Eclipse** | **Reverse** and **Eclipse** |

**Playing an Eclipse card turns every card in the game over:** your hand, everyone else's, the draw pile and the discard pile. The TV darkens as the moon slides across the sun, the table turns from day to night (or back), and every card in your hand flips over on your phone. The card now showing on top of the pile sets the colour. If it's a wild, the next player can play anything.

### Frenzy

- **There are no turns.** The moment a card fits the pile (same colour or same number or symbol), anyone can throw it. Wilds fit any time.
- **The fastest card wins the race.** Phones send cards straight away, and the server takes them in the order they arrive.
- **Beaten by a whisker?** If your card fitted the card you were looking at, but someone else got there up to 0.6 seconds before you, you just lose the race. The card stays in your hand, nobody is punished, and the TV shows the winning margin, for example "Jo beat Shaun by 0.12s!"
- **A card that doesn't fit costs you:** you pick up 2 and can't play for 1.5 seconds. Dimmed cards can still be thrown, so be quick but careful.
- **Skip freezes everyone else for 2 seconds.** Their seats get an ice ring on the TV and their phones frost over.
- **+2 and +4 hit whoever is closest to winning** (the fewest cards), not the next player.
- **Draw a card** whenever you like, but only once every 1.5 seconds.
- **Nothing happening?** If nobody plays for 7 seconds, the top card of the deck is turned onto the pile to get things moving.
- Reverse is just a normal card here, because there's no direction of play.
- Last Card works as usual: call it when you're down to one, or anyone else's next move catches you out.
- Computer players react in real time. Hard ones are quick (well under a second and a half), and Easy ones occasionally throw a card that doesn't fit.

## Match Play

Below the Deal button on the TV, choose how rounds add up. The first player can also choose this from their phone.

| Option | How it works |
|---|---|
| **Single rounds** | Each round stands alone. The TV keeps a tally of wins. |
| **First to 500** | The round winner scores the cards left in everyone else's hands: number cards are worth their number, action cards and Bombs 20, and wild cards 50. In Tag Team, everyone on the winning team scores. The first to 500 wins the match. |
| **Knockout** | After each round, the player left holding the most cards is knocked out and sits out the rest of the match. Ties are settled at random. The last player standing wins. Knockout isn't available in Tag Team. |

When a match is won, press **Start a new match** to reset the scores and bring everyone back in.

## Computer players

You can add computer players to any game, which is handy when you're one short. In the lobby, use the **+** and **−** buttons under **Computer players**, and pick **Easy**, **Medium** or **Hard**.

| Level | How it plays |
|---|---|
| **Easy** | Plays any card that fits and often forgets to call Last Card. Good for children. |
| **Medium** | Saves its wild cards, attacks anyone close to winning, and sometimes forgets to call. |
| **Hard** | Watches which colours other players are missing, makes them draw, and never forgets to call. |

Computer players take a second or two to "think" so you can follow what they did. Click one on the TV to remove it.

## Playing on your own

- **With the TV:** choose **Solo** in the lobby and scan the code with one phone.
- **With just your phone:** open the game on your phone, type your name and tap **Play solo on this phone**. Choose how many opponents and how hard, then tap **Deal me in**. The whole table appears on your phone, and no TV is needed.

## Playing on your phone

- **Swipe a glowing card up** to throw it onto the table, or just tap it. Cards that can't be played are dimmed.
- When it's your turn, the edges of your screen glow in the colour to match, and Android phones buzz. iPhones don't allow websites to buzz.
- The **Last Card!** button lights up red when you're allowed to call it.

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
- `game/modes.js` lists every game for the picker. Set `ready: true` on a game once its rules are built.
- `game/bots.js` holds the computer players.
- `src/input.css` contains the Midnight Lounge design system: colours, fonts, cards and buttons.
- `public/fonts` holds the two typefaces, Bodoni Moda and Manrope, so the game needs no internet for fonts. Both are free under the SIL Open Font License.

**Changing the look:** the styles are pre-built into `public/css/app.css` so the game works offline. After editing `src/input.css` or adding new Tailwind classes, run `npm install` once (this needs internet), then run `npm run build:css`.

**Testing:** `npm test` plays 2,000 random games against the rules and checks that no card is ever lost. It then plays a full round over the network against the real server. This also needs `npm install` first.

**Changing the port:** set `PORT=4000` before starting the server.

**Forcing the QR address:** the QR code normally follows whatever address the TV page was opened on. To override it, set `PUBLIC_URL`, for example `https://cards.example.com`.
