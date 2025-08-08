# Discord Cleanup Bot

Kicks:
- Unverified members who are inactive for UNVERIFIED_INACTIVITY_DAYS (default 30).
- Verified members (no Unverified role) who have 0..VERIFIED_GRACE_POSTS messages outside the Intros channel and have been in the server at least VERIFIED_MIN_DAYS (default 30).
	- This verified purge is controlled by ENABLE_VERIFIED_PURGE and is disabled by default.

Tracking is done by listening to message events and persisting to data/state.json.

## Setup

1) Node.js 18+ recommended.
2) Install dependencies.
3) Create a `.env` from `.env.example` and fill values.
4) Start the bot.

### Discord API setup

1) Create an application and bot
	- Go to https://discord.com/developers/applications → New Application.
	- Open the app → Bot → Add Bot.
	- Reset Token and copy it. Put it in `.env` as `DISCORD_TOKEN`. Never share this token.

2) Enable intents (required for this bot)
	- In Bot → Privileged Gateway Intents:
	  - Server Members Intent: ON (required; the bot fetches members and roles).
	  - Message Content Intent: Optional. The bot doesn’t read content, but enabling ensures message events are delivered consistently.

3) Invite the bot to your server
	- Build an OAuth2 URL: `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=68610&scope=bot%20applications.commands`
	  - Replace `YOUR_CLIENT_ID` with your application’s Client ID (found under OAuth2 → General).
	  - Permissions 68610 includes: Kick Members, View Channels, Send Messages, Read Message History.
	- Open the URL, choose your server, and authorize.

4) Configure server permissions
	- In Server Settings → Roles, drag the bot’s top role above member roles it should be able to kick.
	- Ensure the bot’s role has “Kick Members”.
	- If using `LOG_CHANNEL_ID`, make sure the bot can view and send messages in that channel.

### Install

```powershell
npm install
```

### Configure

Copy `.env.example` -> `.env` and set:
- DISCORD_TOKEN=your bot token
- GUILD_ID=your server ID
- LOG_CHANNEL_ID=(optional) a channel to post logs
- UNVERIFIED_ROLE_ID=role ID for unverified members
- INTROS_CHANNEL_ID=your intros channel ID
- UNVERIFIED_INACTIVITY_DAYS=30
- VERIFIED_GRACE_POSTS=2
- VERIFIED_MIN_DAYS=30
- ENABLE_VERIFIED_PURGE=false (set true to enable verified purge)
- DRY_RUN=true (set to false to actually kick)

### Run

```powershell
npm start
```

The bot triggers a cleanup run 10s after login and then every 24 hours.

## Notes
- The bot counts a message as “outside intros” when it’s in any channel other than INTROS_CHANNEL_ID.
- The first time, the state will be empty; verified users who never posted outside intros and are older than VERIFIED_MIN_DAYS may be eligible immediately, adjust DRY_RUN to preview.
- Make sure the bot has the Kick Members permission and can view/send in the log channel if set.

## License
MIT
