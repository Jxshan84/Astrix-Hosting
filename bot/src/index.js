require("dotenv").config();

const {
  AuditLogEvent,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const { Routes } = require("discord-api-types/v10");
const {
  createDetectionTracker,
  makeEvidenceReference,
  formatSecurityAlert,
} = require("./logic");

const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "");
const botSecret = process.env.ASTRIX_BOT_SYNC_KEY;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
const modLogChannelId = process.env.DISCORD_MOD_LOG_CHANNEL_ID;
const pollInterval = Number(process.env.BOT_POLL_INTERVAL_MS || 5000);
const snowflake = /^\d{17,20}$/;

function validateBackendUrl(value, nodeEnv = process.env.NODE_ENV) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BACKEND_URL must be a valid absolute URL.");
  }
  if (url.username || url.password) {
    throw new Error("BACKEND_URL must not contain embedded credentials.");
  }
  const localDevelopment =
    nodeEnv !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("BACKEND_URL must use HTTPS; HTTP is allowed only for local development.");
  }
  return url;
}

if (!backendUrl || !botSecret || botSecret.length < 32 || !token || !guildId || !snowflake.test(guildId)) {
  throw new Error("Configure BACKEND_URL, ASTRIX_BOT_SYNC_KEY, DISCORD_BOT_TOKEN, and DISCORD_GUILD_ID for the bot.");
}
validateBackendUrl(backendUrl);
if (!Number.isInteger(pollInterval) || pollInterval < 1000 || pollInterval > 60_000) {
  throw new Error("BOT_POLL_INTERVAL_MS must be between 1000 and 60000.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
  ],
});
const detector = createDetectionTracker();
const botHeaders = { "x-astrix-bot-key": botSecret };
let securityConfig = null;
let configExpiresAt = 0;
let polling = false;

async function api(path, options = {}) {
  const response = await fetch(new URL(path, `${backendUrl}/`), {
    ...options,
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
    headers: {
      ...botHeaders,
      ...(options.body && !Buffer.isBuffer(options.body) ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body && !Buffer.isBuffer(options.body) ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Astrix API request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getSecurityConfig(force = false) {
  if (!force && securityConfig && Date.now() < configExpiresAt) return securityConfig;
  try {
    securityConfig = await api("/api/bot/config");
    configExpiresAt = Date.now() + 5_000;
    return securityConfig;
  } catch (error) {
    console.error("Unable to refresh moderation configuration:", error.message);
    securityConfig = {
      enabled: false,
      abusiveTerms: [],
      exemptDiscordIds: [],
      spamThreshold: 8,
      spamWindowSeconds: 10,
      abusiveLanguageRepeatThreshold: 3,
      timeoutMinutes: 10,
    };
    configExpiresAt = Date.now() + 5_000;
    return securityConfig;
  }
}

async function authorized(discordId, permission) {
  const result = await api("/api/bot/authorize", {
    method: "POST",
    body: { discordId, permission },
  });
  return result.authorized ? result : null;
}

async function reportIncident({
  type,
  actorDiscordId,
  targetDiscordId,
  evidenceRef,
  observedCount = 1,
  actionTaken = "observed",
}) {
  return api("/api/bot/incidents", {
    method: "POST",
    body: { incidentType: type, actorDiscordId, targetDiscordId, evidenceRef, observedCount, actionTaken },
  });
}

async function reportModerationAction(incidentId, actionTaken, actorDiscordId) {
  if (!incidentId) return;
  await api(`/api/bot/incidents/${incidentId}/action`, {
    method: "POST",
    body: { actionTaken, actorDiscordId },
  });
}

async function deliverOutboxEvent(event) {
  if (event.type === "announcement") {
    if (!announcementChannelId) throw new Error("Discord announcement channel is not configured.");
    const channel = await client.channels.fetch(announcementChannelId);
    if (!channel?.isTextBased() || !channel.send) throw new Error("Discord announcement channel is unavailable.");
    const payload = event.payload;
    const embed = new EmbedBuilder()
      .setColor(0x9be7ad)
      .setTitle(String(payload.title).slice(0, 256))
      .setDescription(String(payload.message).slice(0, 4000))
      .setFooter({ text: `Astrix Hosting announcement · event ${event.id}` });
    if (typeof payload.link === "string" && /^https?:\/\//i.test(payload.link)) {
      embed.setURL(payload.link);
    }
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
      nonce: String(event.id),
      enforceNonce: true,
    });
    return;
  }

  if (event.type === "appeal_submitted" || event.type === "appeal_decision") {
    if (!snowflake.test(String(event.payload.discordId || ""))) {
      throw new Error("Appeal notification has no linked Discord account.");
    }
    const user = await client.users.fetch(event.payload.discordId);
    if (event.type === "appeal_submitted") {
      await user.send({
        content: `Your Astrix appeal ${event.payload.appealId} was received. Check your appeal status at the Astrix website.`,
        nonce: String(event.id),
        enforceNonce: true,
      });
    } else {
      await user.send({
        content: `Your Astrix appeal ${event.payload.appealId} was ${event.payload.decision}. Sign in to the website to view the review notes.`,
        nonce: String(event.id),
        enforceNonce: true,
      });
    }
    return;
  }

  if (event.type === "security_incident") {
    if (!modLogChannelId) throw new Error("Discord moderation log channel is not configured.");
    const channel = await client.channels.fetch(modLogChannelId);
    if (!channel?.isTextBased() || !channel.send) throw new Error("Discord moderation log channel is unavailable.");
    const alert = formatSecurityAlert(event);
    await channel.send({
      embeds: [new EmbedBuilder().setColor(0xffb347).setTitle(alert.title).setDescription(alert.description)
        .addFields(...alert.fields).setFooter({
          text: `Review this incident in the authorized Astrix owner panel · event ${event.id}`,
        })],
      allowedMentions: { parse: [] },
      nonce: String(event.id),
      enforceNonce: true,
    });
    return;
  }
  throw new Error("Unsupported bot outbox event.");
}

async function pollOutbox() {
  if (polling || !client.isReady()) return;
  polling = true;
  try {
    for (let count = 0; count < 10; count += 1) {
      const { event } = await api("/api/bot/outbox/claim", { method: "POST", body: {} });
      if (!event) break;
      try {
        await deliverOutboxEvent(event);
        await api(`/api/bot/outbox/${event.id}/result`, {
          method: "POST",
          body: { status: "delivered" },
        });
      } catch (error) {
        console.error(`Discord delivery failed for outbox event ${event.id}:`, error.message);
        try {
          await api(`/api/bot/outbox/${event.id}/result`, {
            method: "POST",
            body: { status: "failed", error: String(error.message || "Delivery failed.").slice(0, 400) },
          });
        } catch (reportError) {
          console.error(`Unable to record delivery failure for outbox event ${event.id}:`, reportError.message);
        }
      }
    }
  } catch (error) {
    console.error("Unable to poll Astrix notification outbox:", error.message);
  } finally {
    polling = false;
  }
}

async function safeDiscordAttachment(attachment) {
  if (!attachment || attachment.size > 2 * 1024 * 1024) {
    throw new Error("Evidence attachments must be 2 MB or smaller.");
  }
  const url = new URL(attachment.url);
  if (
    url.protocol !== "https:" ||
    !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
  ) {
    throw new Error("Only attachments hosted by Discord can be uploaded.");
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Discord could not retrieve that attachment.");
  const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!["image/png", "image/jpeg", "application/pdf"].includes(contentType)) {
    throw new Error("Evidence must be PNG, JPEG, or PDF.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The attachment response was empty.");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Evidence attachments must be 2 MB or smaller.");
    }
    chunks.push(Buffer.from(value));
  }
  const data = Buffer.concat(chunks, length);
  const upload = await api(`/api/bot/appeals/${encodeURIComponent(attachment.appealId)}/attachments`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Discord-User-Id": attachment.discordUserId,
      "X-File-Name": attachment.name.slice(0, 120),
    },
    body: data,
  });
  return upload;
}

function commandDefinitions() {
  return [
    new SlashCommandBuilder().setName("appeal").setDescription("Submit an appeal for your linked restricted account")
      .addStringOption((option) => option.setName("explanation").setDescription("Explain why you are appealing").setRequired(true).setMaxLength(4000))
      .addAttachmentOption((option) => option.setName("proof").setDescription("Optional PNG, JPEG, or PDF proof (2 MB maximum)")),
    new SlashCommandBuilder().setName("appeal-status").setDescription("Check one of your submitted appeals")
      .addStringOption((option) => option.setName("appeal_id").setDescription("The appeal ID").setRequired(true).setMaxLength(32)),
    new SlashCommandBuilder().setName("review-appeal").setDescription("Review an appeal (requires appeal-review permission)")
      .addStringOption((option) => option.setName("appeal_id").setDescription("The appeal ID").setRequired(true).setMaxLength(32))
      .addStringOption((option) => option.setName("decision").setDescription("Decision").setRequired(true)
        .addChoices({ name: "Approve", value: "approved" }, { name: "Reject", value: "rejected" }))
      .addStringOption((option) => option.setName("notes").setDescription("Review notes").setRequired(true).setMaxLength(1500)),
    new SlashCommandBuilder().setName("warn").setDescription("Issue a warning (requires Discord moderation permission)")
      .addUserOption((option) => option.setName("user").setDescription("User to warn").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder().setName("timeout").setDescription("Apply a temporary timeout (requires Discord moderation permission)")
      .addUserOption((option) => option.setName("user").setDescription("User to time out").setRequired(true))
      .addIntegerOption((option) => option.setName("minutes").setDescription("Timeout length").setRequired(true).setMinValue(1).setMaxValue(10080))
      .addStringOption((option) => option.setName("reason").setDescription("Reason for the timeout").setRequired(true).setMaxLength(500)),
  ].map((command) => command.toJSON());
}

async function executeAppeal(interaction) {
  const explanation = interaction.options.getString("explanation", true);
  if (explanation.trim().length < 20) {
    await interaction.reply({ content: "Your explanation must be at least 20 characters.", ephemeral: true });
    return;
  }
  const result = await api("/api/bot/appeals", {
    method: "POST",
    body: { discordId: interaction.user.id, explanation },
  });
  const proof = interaction.options.getAttachment("proof");
  if (proof) {
    await safeDiscordAttachment({
      url: proof.url,
      size: proof.size,
      name: proof.name,
      appealId: result.appealId,
      discordUserId: interaction.user.id,
    });
  }
  await interaction.reply({ content: `Appeal ${result.appealId} was submitted. The reviewer will send a website and Discord status notification.`, ephemeral: true });
}

async function executeAppealStatus(interaction) {
  const appealId = interaction.options.getString("appeal_id", true);
  const result = await api(`/api/bot/appeals/${encodeURIComponent(appealId)}?discordId=${encodeURIComponent(interaction.user.id)}`);
  const appeal = result.appeal;
  await interaction.reply({
    content: `Appeal ${appeal.id}: **${appeal.status}** · ${appeal.reason}${appeal.decision_notes ? `\nReviewer notes: ${appeal.decision_notes}` : ""}`,
    ephemeral: true,
  });
}

async function executeReviewAppeal(interaction) {
  const auth = await authorized(interaction.user.id, "appeal_review");
  if (!auth) {
    await interaction.reply({ content: "You do not have appeal-review permission.", ephemeral: true });
    return;
  }
  const appealId = interaction.options.getString("appeal_id", true);
  const decision = interaction.options.getString("decision", true);
  const notes = interaction.options.getString("notes", true);
  const result = await api(`/api/bot/appeals/${encodeURIComponent(appealId)}/decision`, {
    method: "POST",
    body: { discordId: interaction.user.id, decision, notes },
  });
  await interaction.reply({ content: `Appeal ${appealId} ${result.status}. The account holder has been notified.`, ephemeral: true });
}

async function executeModeratorAction(interaction, action) {
  const auth = await authorized(interaction.user.id, "discord_moderation");
  if (!auth) {
    await interaction.reply({ content: "You do not have Discord moderation permission.", ephemeral: true });
    return;
  }
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true).trim();
  const guild = interaction.guild;
  if (!guild || guild.id !== guildId) {
    await interaction.reply({ content: "This moderation command is unavailable in this server.", ephemeral: true });
    return;
  }
  const targetAuth = await authorized(targetUser.id, "discord_moderation");
  if (targetAuth?.isOwner) {
    await interaction.reply({ content: "The configured owner account is protected from Discord moderation actions.", ephemeral: true });
    return;
  }

  let member;
  try {
    member = await guild.members.fetch(targetUser.id);
  } catch {
    await interaction.reply({ content: "That user is not available in this server.", ephemeral: true });
    return;
  }
  if (action === "timeout") {
    const botMember = guild.members.me || await guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers) || botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0 || !member.moderatable) {
      await interaction.reply({ content: "The bot lacks permission or role hierarchy to time out that member.", ephemeral: true });
      return;
    }
  }
  const evidenceRef = makeEvidenceReference("interaction", guild.id, interaction.channelId, interaction.id);
  const report = await reportIncident({
    type: "moderation_action",
    actorDiscordId: interaction.user.id,
    targetDiscordId: targetUser.id,
    evidenceRef,
    actionTaken: "observed",
  });
  try {
    if (action === "warn") {
      await targetUser.send(`A moderator has issued an Astrix warning: ${reason}`);
    } else {
      const minutes = interaction.options.getInteger("minutes", true);
      await member.timeout(minutes * 60_000, `Astrix moderator ${interaction.user.id}: ${reason}`);
    }
    await reportModerationAction(report.incidentId, action === "warn" ? "warned" : "timed_out", interaction.user.id);
    await interaction.reply({ content: `${action === "warn" ? "Warning sent" : "Temporary timeout applied"} to ${targetUser.tag}.`, ephemeral: true });
  } catch (error) {
    await reportModerationAction(report.incidentId, "action_failed", interaction.user.id).catch(() => {});
    console.error(`Discord ${action} action failed:`, error.message);
    await interaction.reply({ content: `The ${action} action failed. A failure incident was recorded for review.`, ephemeral: true });
  }
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "appeal") return await executeAppeal(interaction);
    if (interaction.commandName === "appeal-status") return await executeAppealStatus(interaction);
    if (interaction.commandName === "review-appeal") return await executeReviewAppeal(interaction);
    if (interaction.commandName === "warn" || interaction.commandName === "timeout") {
      return await executeModeratorAction(interaction, interaction.commandName);
    }
  } catch (error) {
    console.error(`Discord command ${interaction.commandName} failed:`, error.message);
    const response = { content: error.status === 404 ? error.message : "The action could not be completed. Please check permissions and try again.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
}

async function handleMessage(message) {
  if (!message.guild || message.guild.id !== guildId || message.author.bot) return;
  const config = await getSecurityConfig();
  if (!config.enabled || config.guildId !== guildId || config.exemptDiscordIds.includes(message.author.id)) return;
  const observations = detector.observe({
    userId: message.author.id,
    content: message.content || "",
    now: Date.now(),
    config,
    exempt: false,
  });
  for (const observation of observations) {
    const evidenceRef = makeEvidenceReference("message", message.guild.id, message.channelId, message.id);
    const incident = await reportIncident({
      type: observation.type,
      actorDiscordId: message.author.id,
      evidenceRef,
      observedCount: observation.count,
      actionTaken: "observed",
    }).catch((error) => {
      console.error("Unable to record a Discord content incident:", error.message);
      return null;
    });
    if (!incident?.incidentId) continue;
    if (incident.recommendation === "warn") {
      try {
        await message.author.send("Astrix detected repeated messages that may be spam. Slow down; further activity can result in a temporary timeout.");
        await reportModerationAction(incident.incidentId, "warned");
      } catch (error) {
        console.error("Unable to deliver the spam warning:", error.message);
        await reportModerationAction(incident.incidentId, "action_failed").catch(() => {});
      }
    } else if (incident.recommendation === "timeout") {
      try {
        const member = await message.guild.members.fetch(message.author.id);
        const botMember = message.guild.members.me || await message.guild.members.fetchMe();
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers) || !member.moderatable || botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
          throw new Error("Bot permissions or role hierarchy do not allow a timeout.");
        }
        await member.timeout(incident.timeoutMinutes * 60_000, "Astrix repeated abuse threshold reached.");
        await reportModerationAction(incident.incidentId, "timed_out");
      } catch (error) {
        console.error("Discord automatic temporary timeout failed:", error.message);
        await reportModerationAction(incident.incidentId, "action_failed").catch(() => {});
      }
    }
  }
}

async function auditActor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((candidate) =>
      candidate.target?.id === targetId && Date.now() - candidate.createdTimestamp < 15_000
    );
    return entry || null;
  } catch (error) {
    console.error("Discord audit log lookup failed:", error.message);
    return null;
  }
}

async function reportUnauthorizedAudit(guild, auditType, targetId, targetDiscordId, evidenceId) {
  const entry = await auditActor(guild, auditType, targetId);
  if (!entry?.executorId || !entry.id) return;
  const auth = await authorized(entry.executorId, "discord_moderation").catch(() => null);
  if (auth) return;
  await reportIncident({
    type: auditType === AuditLogEvent.MemberRoleUpdate ? "unauthorized_role_change" : "destructive_action",
    actorDiscordId: entry.executorId,
    targetDiscordId,
    evidenceRef: makeEvidenceReference("auditlog", guild.id, entry.id, evidenceId),
    actionTaken: "observed",
  }).catch((error) => console.error("Unable to record a Discord audit-log incident:", error.message));
}

async function registerCommands() {
  if (!client.application) return;
  await client.rest.put(Routes.applicationGuildCommands(client.application.id, guildId), {
    body: commandDefinitions(),
  });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Astrix Discord integration online as ${readyClient.user.tag}.`);
  try {
    await registerCommands();
    console.log("Astrix Discord commands registered for the configured guild.");
  } catch (error) {
    console.error("Unable to register Discord commands:", error.message);
  }
  void getSecurityConfig(true);
  void pollOutbox();
  setInterval(() => void pollOutbox(), pollInterval);
});

client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));
client.on(Events.MessageCreate, (message) => void handleMessage(message));
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const changed = oldMember.roles.cache.equals(newMember.roles.cache);
  if (changed) return;
  await reportUnauthorizedAudit(
    newMember.guild,
    AuditLogEvent.MemberRoleUpdate,
    newMember.id,
    newMember.id,
    newMember.id
  );
});
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild || channel.guild.id !== guildId) return;
  await reportUnauthorizedAudit(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id,
    undefined,
    channel.id
  );
});
client.on(Events.GuildRoleDelete, async (role) => {
  if (role.guild.id !== guildId) return;
  await reportUnauthorizedAudit(
    role.guild,
    AuditLogEvent.RoleDelete,
    role.id,
    undefined,
    role.id
  );
});
client.on(Events.Error, (error) => console.error("Discord client error:", error.message));

if (require.main === module) {
  void client.login(token).catch((error) => {
    console.error("Discord bot login failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  client,
  api,
  commandDefinitions,
  deliverOutboxEvent,
  safeDiscordAttachment,
  validateBackendUrl,
};
