

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;


const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || null;
const INTROS_CHANNEL_ID = process.env.INTROS_CHANNEL_ID || null;

const UNVERIFIED_INACTIVITY_DAYS = Number(process.env.UNVERIFIED_INACTIVITY_DAYS || 30);
const VERIFIED_GRACE_POSTS = Number(process.env.VERIFIED_GRACE_POSTS || 2);
const VERIFIED_MIN_DAYS = Number(process.env.VERIFIED_MIN_DAYS || 30);

const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const ENABLE_VERIFIED_PURGE = String(process.env.ENABLE_VERIFIED_PURGE || 'false').toLowerCase() === 'true';

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
let state = { users: {}, lastRunAt: undefined };

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadState() {
  ensureDataDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(raw);
      if (!state.users) state.users = {};
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}
let saveTimer = null;
function saveStateSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      ensureDataDir();
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }, 1500);
}
function recordActivity(userId, channelId, createdTimestamp) {
  if (!userId) return;
  if (!state.users[userId]) state.users[userId] = {};
  const u = state.users[userId];
  if (!u.lastMessageAt || createdTimestamp > u.lastMessageAt) {
    u.lastMessageAt = createdTimestamp;
  }
  if (channelId && channelId !== INTROS_CHANNEL_ID) {
    u.outsideIntroCount = (u.outsideIntroCount || 0) + 1;
  }
  saveStateSoon();
}
function getUserStats(userId) { return state.users[userId] || {}; }
function daysBetween(olderMs, newerMs = Date.now()) {
  if (!olderMs) return Infinity;
  return Math.floor((newerMs - olderMs) / (1000 * 60 * 60 * 24));
}
function chunkForDiscord(text) {
  const MAX_LINES = 50;
  const MAX_BODY_CHARS = 1700;
  const lines = String(text || '').split('\n');
  const chunks = []; let buf = []; let len = 0;
  function flush(){ if (buf.length){ chunks.push(buf.join('\n')); buf=[]; len=0; } }
  for (const line of lines){
    const safe = line ?? '';
    if (safe.length > MAX_BODY_CHARS){
      let i=0; while(i<safe.length){
        const slice = safe.slice(i, i+MAX_BODY_CHARS);
        if (buf.length>=MAX_LINES || len+slice.length+1>MAX_BODY_CHARS) flush();
        buf.push(slice); len += slice.length+1; i+=MAX_BODY_CHARS;
      } continue;
    }
    const add = safe.length+1; if (buf.length>=MAX_LINES || len+add>MAX_BODY_CHARS) flush();
    buf.push(safe); len += add;
  }
  flush(); return chunks;
}



const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});
loadState();
client.once(Events.ClientReady, async (c)=>{
  console.log(`Logged in as ${c.user.tag}`);
  setTimeout(()=>runCleanup().catch(console.error), 10000);
  setInterval(()=>runCleanup().catch(console.error), 24*60*60*1000);
});
client.on(Events.MessageCreate, (message)=>{
  try{ if (!message.guild || message.author.bot) return; recordActivity(message.author.id, message.channelId, message.createdTimestamp);}catch(e){console.error('MessageCreate handler error:', e);}
});

async function runCleanup(){
  if (!GUILD_ID){ console.warn('GUILD_ID not set; skipping cleanup.'); return; }
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.members.fetch();
  const logLines=[]; const actions=[]; const now=Date.now();
  const me = guild.members.me || await guild.members.fetchMe();
  if (!me){ await log('Cleanup: cannot resolve bot member in guild.'); return; }
  const hasKickPerm = me.permissions.has(PermissionsBitField.Flags.KickMembers);
  if (!hasKickPerm){ await log('Cleanup: bot lacks Kick Members permission. Grant it and move the bot role above target roles.'); return; }

  for (const member of guild.members.cache.values()){
    if (member.user.bot) continue;
    const isUnverified = member.roles.cache.has(UNVERIFIED_ROLE_ID);
    const stats = getUserStats(member.id);
    const lastActive = stats.lastMessageAt || member.joinedTimestamp || 0;
    const inactiveDays = daysBetween(lastActive, now);
    const outsideIntro = stats.outsideIntroCount || 0;
    const joinedDays = daysBetween(member.joinedTimestamp || 0, now);
    const tag = `${member.user.tag} (${member.id})`;
    if (isUnverified){
      if (inactiveDays >= UNVERIFIED_INACTIVITY_DAYS){
        if (!member.kickable){
          const botPos = me.roles.highest?.position ?? -1; const userPos = member.roles.highest?.position ?? -1;
          logLines.push(`- skip ${tag}: not kickable (owner or role hierarchy). botRolePos=${botPos}, userRolePos=${userPos}`);
        } else {
          actions.push({ type:'kick', member, reason:`Unverified inactive ${inactiveDays}d (>=${UNVERIFIED_INACTIVITY_DAYS}d)` });
        }
      }
      continue;
    }
    if (ENABLE_VERIFIED_PURGE && outsideIntro <= VERIFIED_GRACE_POSTS && joinedDays >= VERIFIED_MIN_DAYS){
      if (!member.kickable){
        const botPos = me.roles.highest?.position ?? -1; const userPos = member.roles.highest?.position ?? -1;
        logLines.push(`- skip ${tag}: not kickable (owner or role hierarchy). botRolePos=${botPos}, userRolePos=${userPos}`);
      } else {
        actions.push({ type:'kick', member, reason:`No engagement outside intros (count=${outsideIntro} <= ${VERIFIED_GRACE_POSTS}, joined ${joinedDays}d ago)` });
      }
    }
  }
  if (actions.length === 0){ await log(`${DRY_RUN ? '[DRY RUN] ' : ''}Cleanup: no actions.`); state.lastRunAt = now; saveStateSoon(); return; }
  logLines.push(`${DRY_RUN ? '[DRY RUN] ' : ''}Cleanup actions: ${actions.length}`);
  const concurrency = 2; let idx=0; async function next(){ if (idx>=actions.length) return; const current=actions[idx++]; await handleAction(current, logLines); return next(); }
  const runners = Array.from({ length: Math.min(concurrency, actions.length)}, () => next()); await Promise.all(runners);
  state.lastRunAt = now;
  // Persist last run time
  saveStateSoon();
  await log(logLines.join('\n'));
}

async function handleAction(action, logLines){
  if (action.type==='kick'){
    const tag = `${action.member.user.tag} (${action.member.id})`;
    if (!action.member.kickable){ logLines.push(`- cannot kick ${tag}: not kickable (owner or role hierarchy)`); return; }
    if (DRY_RUN){ logLines.push(`- would kick ${tag}: ${action.reason}`); return; }
    try{ await action.member.kick(action.reason); logLines.push(`- kicked ${tag}: ${action.reason}`);}catch(e){ logLines.push(`- FAILED to kick ${tag}: ${e.message || e}`);} }
}

async function log(text){
  console.log(text); if (!LOG_CHANNEL_ID) return;
  try{ const channel = await client.channels.fetch(LOG_CHANNEL_ID); if (!(channel && channel.isTextBased())) return;
    const chunks = chunkForDiscord(text); const total = chunks.length;
    for (let i=0;i<total;i++){ const prefix = total>1?`Cleanup results (part ${i+1}/${total})\n`:''; const content = `${prefix}\u0060\u0060\u0060diff\n${chunks[i]}\n\u0060\u0060\u0060`;
      if (content.length>1900){ const smaller = chunkForDiscord(chunks[i]); for (const piece of smaller){ const subContent = `${prefix}\u0060\u0060\u0060diff\n${piece}\n\u0060\u0060\u0060`; await channel.send({ content: subContent }); } }
      else { await channel.send({ content }); }
    }
  }catch(e){ console.error('Failed to send log message:', e); }
}

process.on('SIGINT', ()=>{ console.log('Shutting down...'); saveStateSoon(); setTimeout(()=>process.exit(0), 500); });
if (!TOKEN){ console.error('DISCORD_TOKEN not set. Create a .env with DISCORD_TOKEN and GUILD_ID.'); process.exit(1); }
client.login(TOKEN);
