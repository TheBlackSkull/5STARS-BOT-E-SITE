const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { config } = require("./config");

const AUTO_TIMEOUT_TICKET_USER_ID = "999363074828021762";
const AUTO_TIMEOUT_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

class TicketSystem {
  constructor(client) {
    this.client = client;
    this.activeTickets = new Map();
    this.creatingTickets = new Set();
    this.syncingTicketChannels = new Set();
    this.ticketCounters = new Map();

    this.registerCommands();
    this.registerEvents();
  }

  registerCommands() {
    // I comandi vengono registrati nel file principale
  }

  registerEvents() {
    this.client.on("interactionCreate", async (interaction) => {
      try {
        if (interaction.isButton()) {
          if (interaction.customId.startsWith("ticket_")) {
            await this.handleCategoryButton(interaction);
          } else if (interaction.customId === "claim_ticket") {
            await this.handleClaimButton(interaction);
          } else if (interaction.customId === "close_ticket") {
            await this.handleCloseButton(interaction);
          } else if (interaction.customId === "confirm_close") {
            await this.handleConfirmClose(interaction);
          } else if (interaction.customId === "cancel_close") {
            await this.handleCancelClose(interaction);
          } else if (interaction.customId === "rename_ticket") {
            await this.handleRenameButton(interaction);
          } else if (interaction.customId === "open_ticket_panel") {
            await this.handleOpenTicketPanel(interaction);
          }
        } else if (interaction.isModalSubmit()) {
          if (interaction.customId === "rename_ticket_modal") {
            await this.handleRenameModalSubmit(interaction);
          }
        }
      } catch (error) {
        console.error("[ticket] Errore gestione interazione:", error);

        if (interaction.isRepliable()) {
          const payload = {
            content: "Errore ticket. Riprova tra poco.",
            ephemeral: true
          };

          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload).catch(() => null);
          } else {
            await interaction.reply(payload).catch(() => null);
          }
        }
      }
    });

    this.client.on("channelUpdate", async (oldChannel, newChannel) => {
      try {
        await this.handleChannelUpdate(oldChannel, newChannel);
      } catch (error) {
        console.error("[ticket] Errore auto-sync permessi:", error);
      }
    });
  }

  getGuildConfig(guildOrId) {
    const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id || guildOrId?.guild?.id;
    return config.getGuildConfig(guildId);
  }

  getCategoryFromParent(parentId, guildConfig) {
    return Object.entries(guildConfig.ticketCategories || {}).find(([, id]) => id === parentId)?.[0] || null;
  }

  getTicketCategorySettings(guildConfig, category) {
    const settings = guildConfig.ticketCategorySettings || {};
    const configured = settings[category] || {};
    const categoryId = configured.categoryId || guildConfig.ticketCategories?.[category] || null;
    if (!categoryId) return null;

    return {
      key: category,
      label: configured.label || category,
      emoji: configured.emoji,
      description: configured.description || "Descrivi la tua richiesta e attendi lo staff.",
      categoryId,
      logChannelId: configured.logChannelId || guildConfig.ticketLogChannelId || null,
      transcriptChannelId: configured.transcriptChannelId || guildConfig.ticketTranscriptChannelId || configured.logChannelId || guildConfig.ticketLogChannelId || null
    };
  }

  getEnabledTicketCategories(guildConfig) {
    return Object.keys(guildConfig.ticketCategories || {})
      .map((category) => this.getTicketCategorySettings(guildConfig, category))
      .filter(Boolean);
  }

  getTicketCategoryLabel(guildConfig, category) {
    const settings = this.getTicketCategorySettings(guildConfig, category);
    return settings ? `${settings.emoji} ${settings.label}`.trim() : category;
  }

  getTicketCounter(guildId) {
    return this.ticketCounters.get(guildId) || 0;
  }

  setTicketCounter(guildId, ticketNumber) {
    if (!guildId || !Number.isInteger(ticketNumber)) return;
    this.ticketCounters.set(guildId, Math.max(this.getTicketCounter(guildId), ticketNumber));
  }

  nextTicketNumber(guildId) {
    const next = this.getTicketCounter(guildId) + 1;
    this.ticketCounters.set(guildId, next);
    return next;
  }

  getTicketNumber(channelName) {
    const match = /^ticket-(\d+)$/i.exec(channelName || "");
    return match ? Number.parseInt(match[1], 10) : null;
  }

  parseTicketTopic(channel) {
    const rawTopic = channel.topic || "";
    if (!rawTopic.startsWith("5stars-ticket:")) return null;

    const values = {};
    for (const part of rawTopic.slice("5stars-ticket:".length).split(";")) {
      const [key, value] = part.split("=");
      if (key && value) values[key.trim()] = value.trim();
    }

    if (!values.user || !values.category) return null;

    return {
      userId: values.user,
      category: values.category,
      channelId: channel.id,
      createdAt: channel.createdTimestamp || Date.now(),
      claimedBy: values.claimed && values.claimed !== "none" ? values.claimed : null,
      ticketNumber: values.number ? Number.parseInt(values.number, 10) : null,
      addedUserIds: values.guests && values.guests !== "none"
        ? values.guests.split(",").map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id))
        : []
    };
  }

  buildTicketTopic(ticketData) {
    const ticketNumber = Number.isInteger(ticketData.ticketNumber) ? ticketData.ticketNumber : 0;
    const claimedBy = ticketData.claimedBy || "none";
    const addedUserIds = Array.isArray(ticketData.addedUserIds)
      ? [...new Set(ticketData.addedUserIds.filter((id) => /^\d{5,25}$/.test(String(id))))]
      : [];
    const guests = addedUserIds.length ? addedUserIds.join(",") : "none";
    return ``;
  }

  rememberTicket(channel, data) {
    const ticketNumber = Number.isInteger(data.ticketNumber) ? data.ticketNumber : this.getTicketNumber(channel.name);
    const guildId = channel.guild?.id || data.guildId || null;
    this.setTicketCounter(guildId, ticketNumber);

    this.activeTickets.set(channel.id, {
      guildId,
      userId: data.userId || null,
      category: data.category,
      channelId: channel.id,
      createdAt: data.createdAt || Date.now(),
      claimedBy: data.claimedBy || null,
      ticketNumber: Number.isInteger(ticketNumber) ? ticketNumber : null,
      addedUserIds: Array.isArray(data.addedUserIds) ? [...new Set(data.addedUserIds)] : []
    });

    return this.activeTickets.get(channel.id);
  }

  resolveTicketData(channel) {
    if (!channel) return null;

    const activeTicket = this.activeTickets.get(channel.id);
    if (activeTicket) return activeTicket;

    const topicTicket = this.parseTicketTopic(channel);
    if (topicTicket) {
      return this.rememberTicket(channel, topicTicket);
    }

    const guildConfig = this.getGuildConfig(channel.guild);
    const category = this.getCategoryFromParent(channel.parentId, guildConfig);
    if (!category || !/^ticket-\d+$/i.test(channel.name || "")) {
      return null;
    }

    return this.rememberTicket(channel, {
      userId: null,
      category,
      createdAt: channel.createdTimestamp || Date.now()
    });
  }

  canManageTicket(interaction, ticketData) {
    if (this.isStaff(interaction.member)) {
      return true;
    }

    if (ticketData.userId && ticketData.userId === interaction.user.id) {
      return true;
    }

    return false;
  }

  isStaff(member) {
    if (!member) return false;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    const guildConfig = this.getGuildConfig(member.guild);
    return guildConfig.staffRoleIds.some((roleId) => member.roles?.cache?.has(roleId));
  }

  permissionValue(value) {
    return BigInt(value || 0);
  }

  denyEveryoneView(overwrite = {}, guildId) {
    const allow = this.permissionValue(overwrite.allow) & ~PermissionFlagsBits.ViewChannel;
    const deny = this.permissionValue(overwrite.deny) | PermissionFlagsBits.ViewChannel;
    return { id: guildId, type: overwrite.type ?? OverwriteType.Role, allow, deny };
  }

  buildTicketMemberOverwrite(userId) {
    return {
      id: userId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    };
  }
/////////////////////////////

  buildTicketPermissionOverwrites(guild, categoryChannel, ticketData, guildConfig = this.getGuildConfig(guild)) {
    const overwrites = new Map();

    for (const overwrite of categoryChannel.permissionOverwrites.cache.values()) {
      overwrites.set(overwrite.id, {
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString()
      });
    }

    overwrites.set(guild.id, this.denyEveryoneView(overwrites.get(guild.id), guild.id));

    if (ticketData.userId) {
      overwrites.set(ticketData.userId, this.buildTicketMemberOverwrite(ticketData.userId));
    }

    for (const userId of ticketData.addedUserIds || []) {
      if (!userId || userId === ticketData.userId) continue;
      overwrites.set(userId, this.buildTicketMemberOverwrite(userId));
    }

    return Array.from(overwrites.values());
  }

  async syncTicketCategoryBase(channel, categoryChannel, reason) {
    try {
      if (channel.parentId !== categoryChannel.id) {
        await channel.setParent(categoryChannel.id, { lockPermissions: true, reason });
        return true;
      }
      await channel.lockPermissions();
      return true;
    } catch (error) {
      console.error("[ticket] Errore sync base permessi:", error);
      return false;
    }
  }

  async syncTicketPermissions(channel, ticketData, reason = "Sync permessi categoria ticket") {
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    if (!ticketData?.category) return false;

    const guildConfig = this.getGuildConfig(channel.guild);
    const categoryId = guildConfig.ticketCategories[ticketData.category] || channel.parentId;
    const categoryChannel = await channel.guild.channels.fetch(categoryId).catch(() => null);

    if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
      return false;
    }

    this.syncingTicketChannels.add(channel.id);
    try {
      await this.syncTicketCategoryBase(channel, categoryChannel, reason);
      await channel.permissionOverwrites.set(
        this.buildTicketPermissionOverwrites(channel.guild, categoryChannel, ticketData, guildConfig),
        reason
      );
      return true;
    } finally {
      setTimeout(() => this.syncingTicketChannels.delete(channel.id), 2000).unref?.();
    }
  }

///////////////////////////////////////////////////////////////////////////////////////
  async updateTicketTopic(channel, ticketData) {
    if (!channel || !ticketData) return;
    const topic = this.buildTicketTopic(ticketData);
    if (channel.topic === topic) return;
    await channel.setTopic(topic, "Aggiornamento metadata ticket").catch((error) => {
      console.error("[ticket] Errore aggiornamento topic:", error);
    });
  }

  async handleChannelUpdate(oldChannel, newChannel) {
    const guildConfig = this.getGuildConfig(newChannel.guild);

    if (newChannel.type === ChannelType.GuildCategory) {
      const category = this.getCategoryFromParent(newChannel.id, guildConfig);
      if (!category) return;

      let synced = 0;
      for (const ticketData of this.activeTickets.values()) {
        if (ticketData.guildId !== newChannel.guild.id) continue;
        if (ticketData.category !== category) continue;

        const channel = await newChannel.guild.channels.fetch(ticketData.channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) continue;

        if (await this.syncTicketPermissions(channel, ticketData, "Auto-sync permessi categoria ticket")) {
          synced++;
        }
      }

      if (synced > 0) {
        console.log(`[ticket] Auto-sync permessi categoria ${category}: ${synced} ticket aggiornati.`);
      }
      return;
    }

    if (this.syncingTicketChannels.has(newChannel.id)) return;

    const ticketData = this.resolveTicketData(newChannel);
    if (!ticketData) return;

    await this.syncTicketPermissions(newChannel, ticketData, "Auto-sync permessi ticket");
  }

  async initializeFromGuild(guild) {
    const guildConfig = this.getGuildConfig(guild);
    const channels = await guild.channels.fetch().catch((error) => {
      console.error("[ticket] Errore caricamento canali ticket:", error);
      return null;
    });

    if (!channels) return;

    let restored = 0;
    let synced = 0;
    for (const channel of channels.values()) {
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const ticketData = this.resolveTicketData(channel);
      if (!ticketData) continue;

      restored++;
      if (await this.syncTicketPermissions(channel, ticketData, "Sync iniziale permessi ticket")) {
        synced++;
      }
    }

    console.log(`[ticket] ${guild.name}: ticket attivi ripristinati: ${restored}. Permessi sincronizzati: ${synced}. Prossimo numero: ${this.getTicketCounter(guild.id) + 1}. Categorie configurate: ${Object.keys(guildConfig.ticketCategories || {}).length}.`);
  }

  async handleTicketCommand(interaction) {
    const guildConfig = this.getGuildConfig(interaction.guild);
    const configuredCategories = this.getEnabledTicketCategories(guildConfig);

    if (!interaction.guild) {
      return await interaction.reply({
        content: "Questo comando puo essere usato solo in un server Discord.",
        ephemeral: true
      });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: "Solo gli amministratori possono creare pannelli ticket.",
        ephemeral: true
      });
    }

    if (configuredCategories.length === 0) {
      return await interaction.reply({
        content: "Categorie ticket non configurate per questo server.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("🎫 Sistema Ticket 5STARS")
      .setDescription("Seleziona la categoria per aprire un ticket:")
      .setColor(0xd8b45b)
      .setTimestamp();

    const rows = [];
    const buttons = configuredCategories.slice(0, 25).map((category) => new ButtonBuilder()
      .setCustomId(`ticket_${category.key}`)
      .setLabel(`${category.emoji} ${category.label}`.trim().slice(0, 80))
      .setStyle(ButtonStyle.Primary));

    for (let index = 0; index < buttons.length; index += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
    }

    await interaction.reply({
      content: "Pannello ticket creato!",
      ephemeral: true
    });

    await interaction.channel.send({
      embeds: [embed],
      components: rows
    });
  }
  async handleCategorySelect(interaction) {
    const category = interaction.values[0];
    await this.createTicket(interaction, category);
  }

  async applyTicketOpenTimeout(interaction) {
    if (interaction.user.id !== AUTO_TIMEOUT_TICKET_USER_ID) return;

    const member = interaction.member?.timeout
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id);

    if (!member.moderatable) {
      console.warn(
        `[ticket] Impossibile applicare il timeout a ${interaction.user.tag} (${interaction.user.id}): membro non moderabile.`
      );
      return;
    }

    await member.timeout(
      AUTO_TIMEOUT_DURATION_MS,
      "Timeout automatico di 3 giorni applicato all'apertura di un ticket."
    );
    console.log(
      `[ticket] Timeout di 3 giorni applicato a ${interaction.user.tag} (${interaction.user.id}).`
    );
  }

  async handleCategoryButton(interaction) {
    const category = interaction.customId.replace("ticket_", "");
    // Mappa permdeath a permadeath per compatibilitÃ 
    const mappedCategory = category === "permdeath" ? "permadeath" : category;

    try {
      await this.applyTicketOpenTimeout(interaction);
    } catch (error) {
      console.error(
        `[ticket] Errore durante il timeout automatico di ${interaction.user.id}:`,
        error
      );
    }

    await this.createTicket(interaction, mappedCategory);
  }

  buildTicketControls(ticketData) {
    const claimButton = new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel(ticketData?.claimedBy ? "Claimed" : "Claim")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(ticketData?.claimedBy));

    const renameButton = new ButtonBuilder()
      .setCustomId("rename_ticket")
      .setLabel("Rinomina")
      .setStyle(ButtonStyle.Primary);

    const closeButton = new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Chiudi Ticket")
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(claimButton, renameButton, closeButton);
  }

  buildTicketChannelName(ticketData, input) {
    const suffix = this.normalizeChannelName(input)
      .replace(/^ticket-?\d*-?/i, "")
      .replace(/^-|-$/g, "");
    const ticketNumber = Number.isInteger(ticketData?.ticketNumber)
      ? ticketData.ticketNumber.toString().padStart(4, "0")
      : null;
    const baseName = ticketNumber ? `ticket-${ticketNumber}` : "ticket";
    const fullName = suffix ? `${baseName}-${suffix}` : baseName;
    return fullName.slice(0, 100).replace(/-$/g, "");
  }

  async createTicket(interaction, category) {
    const guildConfig = this.getGuildConfig(interaction.guild);
    const categoryConfig = this.getTicketCategorySettings(guildConfig, category);
    const categoryId = categoryConfig?.categoryId;

    if (!categoryId) {
      return await interaction.reply({
        content: "Categoria non valida.",
        ephemeral: true
      });
    }

    // Verifica se l'utente ha già  un ticket aperto della STESSA categoria
    let existingTicket = Array.from(this.activeTickets.values()).find(
      ticket => ticket.guildId === interaction.guild.id && ticket.userId === interaction.user.id && ticket.category === category
    );

    if (existingTicket) {
      const actualChannel = await interaction.guild.channels.fetch(existingTicket.channelId).catch(() => null);

      if (!actualChannel) {
        console.log(`[ticket] Canale fantasma rimosso dalla memoria: ${existingTicket.channelId}`);
        this.activeTickets.delete(existingTicket.channelId);
        existingTicket = null;
      } else {
        return await interaction.reply({
          content: `Hai già un ticket aperto in questa categoria: <#${existingTicket.channelId}>`,
          ephemeral: true
        });
      }
    }

    const creationKey = `${interaction.guild.id}:${interaction.user.id}:${category}`;
    if (this.creatingTickets.has(creationKey)) {
      return await interaction.reply({
        content: "Sto già creando il tuo ticket, attendi qualche secondo.",
        ephemeral: true
      });
    }

    this.creatingTickets.add(creationKey);
    await interaction.deferReply({ ephemeral: true });

    try {
      // Trova la categoria
      const categoryChannel = await interaction.guild.channels.fetch(categoryId);
      if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
        return await interaction.editReply("Categoria ticket non trovata.");
      }

      // Genera numero ticket
      const ticketNumber = this.nextTicketNumber(interaction.guild.id);
      const ticketNumberLabel = ticketNumber.toString().padStart(4, '0');
      const channelName = `ticket-${ticketNumberLabel}`;

      // Crea il canale ticket con accesso staff e permessi della categoria.
      // Gli overwrite iniziali impediscono leak immediati; subito dopo viene fatto
      // il lock/sync reale con la categoria e vengono riapplicate solo le eccezioni ticket.
      const ticketData = {
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        category,
        createdAt: Date.now(),
        claimedBy: null,
        ticketNumber
      };

      const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        topic: this.buildTicketTopic(ticketData),
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: this.buildTicketPermissionOverwrites(interaction.guild, categoryChannel, ticketData, guildConfig)
      });

      // Salva il ticket attivo
      this.rememberTicket(ticketChannel, ticketData);
      await this.syncTicketPermissions(ticketChannel, ticketData, "Sync permessi ticket creato");

      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`Ticket #${ticketNumberLabel}`)
        .setDescription(`**Categoria:** ${this.getTicketCategoryLabel(guildConfig, category)}\n**Utente:** ${interaction.user}\n\n${categoryConfig.description}`)
        .setColor(0x00ff00)
        .setTimestamp();

      const closeButton = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Chiudi Ticket")
        .setStyle(ButtonStyle.Danger)

      const renameButton = new ButtonBuilder()
        .setCustomId("rename_ticket")
        .setLabel("Rinomina")
        .setStyle(ButtonStyle.Primary)

      const row = new ActionRowBuilder().addComponents(closeButton, renameButton);

      const staffMentions = guildConfig.staffRoleIds.map((roleId) => `<@&${roleId}>`).join(" ");
      await ticketChannel.send({
        content: `${interaction.user} ha aperto un ticket.${staffMentions ? `\n${staffMentions}` : ""}`,
        allowedMentions: staffMentions ? { roles: guildConfig.staffRoleIds } : { parse: [] },
        embeds: [welcomeEmbed],
        components: [this.buildTicketControls(ticketData)]
      });

      await interaction.editReply(`Ticket creato con successo: <#${ticketChannel.id}>`);

    } catch (error) {
      console.error("[ticket] Errore creazione ticket:", error);
      await interaction.editReply("Errore nella creazione del ticket. Riprova piÃ¹ tardi.");
    } finally {
      this.creatingTickets.delete(creationKey);
    }
  }

  async handleClaimButton(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) {
      return await interaction.reply({
        content: "Questo canale non risulta un ticket attivo.",
        ephemeral: true
      });
    }

    if (!this.isStaff(interaction.member)) {
      return await interaction.reply({
        content: "Solo lo staff puo claimare i ticket.",
        ephemeral: true
      });
    }

    if (ticketData.claimedBy) {
      const alreadyClaimedByUser = ticketData.claimedBy === interaction.user.id;
      const canReclaim = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

      if (!canReclaim) {
        return await interaction.reply({
          content: alreadyClaimedByUser
            ? "Hai gia claimato questo ticket."
            : `Ticket gia claimato da <@${ticketData.claimedBy}>.`,
          ephemeral: true
        });
      }
    }

    await interaction.deferUpdate();

    ticketData.claimedBy = interaction.user.id;
    this.activeTickets.set(interaction.channel.id, ticketData);
    await this.updateTicketTopic(interaction.channel, ticketData);
    await this.syncTicketPermissions(interaction.channel, ticketData, `Ticket claimato da ${interaction.user.tag}`);

    await interaction.message.edit({
      components: [this.buildTicketControls(ticketData)]
    });

    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Ticket Claimato")
          .setDescription(`Ticket preso in carico da ${interaction.user}.`)
          .setColor(0x2ecc71)
          .setTimestamp()
      ]
    });
  }

  async handleCloseCommand(interaction) {
    // Verifica se siamo in un canale ticket
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) {
      return await interaction.reply({
        content: "Questo comando può essere usato solo nei canali ticket.",
        ephemeral: true
      });
    }

    // Verifica se l'utente Ã¨ il creatore del ticket o ha permessi admin
    if (!this.canManageTicket(interaction, ticketData)) {
      return await interaction.reply({
        content: "Solo il creatore del ticket o un amministratore puÃ² chiuderlo.",
        ephemeral: true
      });
    }

    await this.closeTicket(interaction.channel, interaction.user, "Comando /close");
  }

  async handleRenameCommand(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) {
      return await interaction.reply({
        content: "Questo comando può essere usato solo nei canali ticket.",
        ephemeral: true
      });
    }

    if (!this.isStaff(interaction.member)) {
      return await interaction.reply({
        content: "Solo lo staff può rinominare i ticket.",
        ephemeral: true
      });
    }

    const rawName = interaction.options.getString("nome", true);
    await interaction.deferReply({ ephemeral: true });
    await this.renameTicketChannel(interaction.channel, ticketData, rawName, interaction.user, interaction);
  }

  async handleAddUserCommand(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) {
      return await interaction.reply({
        content: "Questo comando può essere usato solo nei canali ticket.",
        ephemeral: true
      });
    }

    if (!this.isStaff(interaction.member)) {
      return await interaction.reply({
        content: "Solo lo staff può aggiungere persone ai ticket.",
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser("utente", true);
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return await interaction.reply({
        content: "Utente non trovato nel server.",
        ephemeral: true
      });
    }

    if (targetUser.bot) {
      return await interaction.reply({
        content: "Non puoi aggiungere bot ai ticket.",
        ephemeral: true
      });
    }

    if (targetUser.id === ticketData.userId) {
      return await interaction.reply({
        content: "Questo utente è già il creatore del ticket.",
        ephemeral: true
      });
    }

    const addedUserIds = new Set(ticketData.addedUserIds || []);
    if (addedUserIds.has(targetUser.id)) {
      return await interaction.reply({
        content: `${targetUser} ha gia accesso a questo ticket.`,
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      addedUserIds.add(targetUser.id);
      ticketData.addedUserIds = [...addedUserIds];
      this.activeTickets.set(interaction.channel.id, ticketData);
      await this.updateTicketTopic(interaction.channel, ticketData);
      await this.syncTicketPermissions(interaction.channel, ticketData, `Utente aggiunto al ticket da ${interaction.user.tag}`);

      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Utente aggiunto al ticket")
            .setDescription(`${targetUser} è stato aggiunto da ${interaction.user}.`)
            .setColor(0x2ecc71)
            .setTimestamp()
        ]
      });

      await this.sendTicketAccessLog(interaction.channel, ticketData, targetUser, interaction.user, "aggiunto");
      await interaction.editReply(`${targetUser} aggiunto al ticket.`);
    } catch (error) {
      console.error("[ticket] Errore aggiunta utente al ticket:", error);
      await interaction.editReply("Errore durante l'aggiunta dell'utente al ticket. Controlla che il bot abbia Gestisci Canali.");
    }
  }

  async handleCloseButton(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) return;

    // Verifica permessi
    if (!this.canManageTicket(interaction, ticketData)) {
      return await interaction.reply({
        content: "Solo il creatore del ticket o un amministratore può chiuderlo.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const confirmEmbed = new EmbedBuilder()
      .setTitle(":lock: Conferma Chiusura")
      .setDescription("Sei sicuro di voler chiudere questo ticket?")
      .setColor(0xffa500);

    const confirmButton = new ButtonBuilder()
      .setCustomId("confirm_close")
      .setLabel("Conferma")
      .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
      .setCustomId("cancel_close")
      .setLabel("Annulla")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    await interaction.editReply({
      embeds: [confirmEmbed],
      components: [row]
    });
  }

  async handleConfirmClose(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) return;

    if (!this.canManageTicket(interaction, ticketData)) {
      return await interaction.reply({
        content: "Non hai il permesso di chiudere questo ticket.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await this.closeTicket(interaction.channel, interaction.user, "Pulsante chiusura");

      // Prova a editare la risposta (potrebbe fallire se il canale Ã¨ giÃ  stato eliminato)
      try {
        await interaction.editReply({ content: "Ticket chiuso e canale eliminato.", embeds: [], components: [] });
      } catch (error) {
        console.log("[ticket] Canale già  eliminato, interazione non editabile.");
      }
    } catch (error) {
      console.error("[ticket] Errore nel chiudere il ticket:", error);
      try {
        await interaction.editReply({ content: "Errore nella chiusura del ticket.", embeds: [], components: [] });
      } catch (e) {
        console.log("[ticket] Impossibile rispondere all'interazione.");
      }
    }
  }

  async handleCancelClose(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ content: "Chiusura ticket annullata.", embeds: [], components: [] });
  }

  async handleRenameButton(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) return;

    // Verifica se l'utente Ã¨ staff
    if (!this.isStaff(interaction.member)) {
      return await interaction.reply({
        content: "Solo lo staff può rinominare i ticket.",
        ephemeral: true
      });
    }

    // Crea il modal
    const modal = new ModalBuilder()
      .setCustomId("rename_ticket_modal")
      .setTitle("Rinomina Ticket");

    const input = new TextInputBuilder()
      .setCustomId("new_name_input")
      .setLabel("Nuovo nome del ticket")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Es: supporto-donazione")
      .setMinLength(1)
      .setMaxLength(80);

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  normalizeChannelName(input) {
    const cleaned = String(input || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90);

    return cleaned || "ticket";
  }

  async sendTicketRenameLog(channel, ticketData, oldName, newName, renamedBy) {
    try {
      const guildConfig = this.getGuildConfig(channel.guild);
      const categoryConfig = ticketData?.category ? this.getTicketCategorySettings(guildConfig, ticketData.category) : null;
      const ticketLogChannelId = categoryConfig?.logChannelId || guildConfig.ticketLogChannelId;
      if (!ticketLogChannelId) return;

      const ticketLogChannel = await channel.guild.channels.fetch(ticketLogChannelId).catch(() => null);
      if (!ticketLogChannel?.isTextBased()) return;

      await ticketLogChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ticket Rinominato")
            .setDescription(`**Ticket:** ${channel}\n**Da:** #${oldName}\n**A:** #${newName}\n**Rinominato da:** ${renamedBy}`)
            .setColor(0x3498db)
            .setTimestamp()
        ]
      });
    } catch (error) {
      console.error("[ticket] Errore log rinomina ticket:", error);
    }
  }

  async sendTicketAccessLog(channel, ticketData, targetUser, changedBy, action) {
    try {
      const guildConfig = this.getGuildConfig(channel.guild);
      const categoryConfig = ticketData?.category ? this.getTicketCategorySettings(guildConfig, ticketData.category) : null;
      const ticketLogChannelId = categoryConfig?.logChannelId || guildConfig.ticketLogChannelId;
      if (!ticketLogChannelId) return;

      const ticketLogChannel = await channel.guild.channels.fetch(ticketLogChannelId).catch(() => null);
      if (!ticketLogChannel?.isTextBased()) return;

      await ticketLogChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Accesso Ticket Aggiornato")
            .setDescription(`**Ticket:** ${channel}\n**Utente:** ${targetUser}\n**Azione:** ${action}\n**Staff:** ${changedBy}`)
            .setColor(0x2ecc71)
            .setTimestamp()
        ]
      });
    } catch (error) {
      console.error("[ticket] Errore log accesso ticket:", error);
    }
  }

  async renameTicketChannel(channel, ticketData, rawName, renamedBy, interaction = null) {
    const oldName = channel.name;
    const newName = this.buildTicketChannelName(ticketData, rawName);

    if (oldName === newName) {
      const message = `Il ticket si chiama gia #${newName}.`;
      if (interaction?.editReply) {
        await interaction.editReply(message);
      }
      return { changed: false, name: newName };
    }

    try {
      await channel.setName(newName, `Ticket rinominato da ${renamedBy.tag}`);
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ticket Rinominato")
            .setDescription(`Il ticket è stato rinominato da ${renamedBy}.\n**Nuovo nome:** #${newName}`)
            .setColor(0x3498db)
            .setTimestamp()
        ]
      }).catch(() => null);
      await this.sendTicketRenameLog(channel, ticketData, oldName, newName, renamedBy);

      if (interaction?.editReply) {
        await interaction.editReply(`Ticket rinominato in #${newName}.`);
      }

      return { changed: true, name: newName };
    } catch (error) {
      console.error("[ticket] Errore rinomina ticket:", error);
      if (interaction?.editReply) {
        await interaction.editReply("Errore durante la rinomina del ticket. Controlla che il bot abbia Gestisci Canali.");
      }
      return { changed: false, name: oldName, error };
    }
  }

  async handleRenameModalSubmit(interaction) {
    const ticketData = this.resolveTicketData(interaction.channel);
    if (!ticketData) {
      return await interaction.reply({
        content: "Questo canale non risulta un ticket attivo.",
        ephemeral: true
      });
    }

    if (!this.isStaff(interaction.member)) {
      return await interaction.reply({
        content: "Solo lo staff può rinominare i ticket.",
        ephemeral: true
      });
    }

    const rawName = interaction.fields.getTextInputValue("new_name_input");

    await interaction.deferReply({ ephemeral: true });
    await this.renameTicketChannel(interaction.channel, ticketData, rawName, interaction.user, interaction);
  }

  async handleOpenTicketPanel(interaction) {
    if (!interaction.guild) {
      return await interaction.reply({
        content: "Questo pannello può essere usato solo nel server 5STARS.",
        ephemeral: true
      });
    }

    // Verifica se l'utente ha giÃ  un ticket aperto
    const existingTicket = Array.from(this.activeTickets.values()).find(
      ticket => ticket.guildId === interaction.guild.id && ticket.userId === interaction.user.id
    );

    if (existingTicket) {
      return await interaction.reply({
        content: `Hai già  un ticket aperto: <#${existingTicket.channelId}>`,
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(":ticket: Sistema Ticket 5STARS")
      .setDescription("Seleziona la categoria del tuo ticket:")
      .setColor(0x0099ff)
      .setTimestamp();

    // Crea bottoni per ogni categoria
    const buttons = [
      new ButtonBuilder()
        .setCustomId("ticket_gestione")
        .setLabel("Gestione")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_developer")
        .setLabel("Developer")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_azioni")
        .setLabel("Azioni")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_convalide")
        .setLabel("Convalide")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_permdeath")
        .setLabel("Permadeath")
        .setStyle(ButtonStyle.Primary)
    ];

    const buttons2 = [
      new ButtonBuilder()
        .setCustomId("ticket_donazioni")
        .setLabel("Donazioni")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_fazioni")
        .setLabel("Fazioni")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ticket_generale")
        .setLabel("Generale")
        .setStyle(ButtonStyle.Primary)
    ];

    const row1 = new ActionRowBuilder().addComponents(buttons);
    const row2 = new ActionRowBuilder().addComponents(buttons2);

    await interaction.reply({
      embeds: [embed],
      components: [row1, row2],
      ephemeral: true
    });
  }

  async generateTranscript(channel) {
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      const transcript = [];

      transcript.push(`Transcript del ticket: ${channel.name}`);
      transcript.push(`Creato il: ${channel.createdAt.toLocaleString('it-IT')}`);
      transcript.push(`Categoria: ${this.getCategoryName(channel)}`);
      transcript.push('='.repeat(50));
      transcript.push('');

      // Ordina i messaggi dal piÃ¹ vecchio al piÃ¹ nuovo
      const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      for (const message of sortedMessages.values()) {
        const timestamp = message.createdAt.toLocaleString('it-IT');
        const author = message.author ? `${message.author.username}#${message.author.discriminator}` : 'Sistema';
        const content = message.content || '[Contenuto non testuale]';

        transcript.push(`[${timestamp}] ${author}: ${content}`);

        // Aggiungi allegati se presenti
        if (message.attachments.size > 0) {
          transcript.push('  Allegati:');
          message.attachments.forEach(attachment => {
            transcript.push(`    - ${attachment.name} (${attachment.url})`);
          });
        }

        // Aggiungi embed se presenti
        if (message.embeds.length > 0) {
          transcript.push('  Embed:');
          message.embeds.forEach(embed => {
            if (embed.title) transcript.push(`    Titolo: ${embed.title}`);
            if (embed.description) transcript.push(`    Descrizione: ${embed.description}`);
            if (embed.fields.length > 0) {
              transcript.push('    Campi:');
              embed.fields.forEach(field => {
                transcript.push(`      ${field.name}: ${field.value}`);
              });
            }
          });
        }
      }

      return transcript.join('\n');
    } catch (error) {
      console.error("[ticket] Errore generazione transcript:", error);
      return "Errore nella generazione della transcript";
    }
  }

  getCategoryName(channel) {
    const ticketData = this.resolveTicketData(channel);
    if (ticketData?.category) {
      return this.getTicketCategoryLabel(this.getGuildConfig(channel.guild), ticketData.category);
    }
    return 'Sconosciuta';
  }

  async sendTranscriptToStaff(channel, transcript, closedBy, reason) {
    try {
      const guildConfig = this.getGuildConfig(channel.guild);
      const ticketData = this.resolveTicketData(channel);
      const categoryConfig = ticketData?.category ? this.getTicketCategorySettings(guildConfig, ticketData.category) : null;
      const staffChannelId = categoryConfig?.transcriptChannelId || guildConfig.ticketTranscriptChannelId || guildConfig.ticketLogChannelId;
      if (!staffChannelId) {
        console.warn(`[ticket] Canale transcript non configurato per ${channel.guild.name}.`);
        return;
      }

      const staffChannel = await channel.guild.channels.fetch(staffChannelId).catch(() => null);

      if (!staffChannel || !staffChannel.isTextBased()) {
        console.error("[ticket] Canale staff non trovato o non valido");
        return;
      }

      // Crea il file della transcript
      const fileName = `transcript-${channel.name}-${Date.now()}.txt`;
      const buffer = Buffer.from(transcript, 'utf-8');

      const embed = new EmbedBuilder()
        .setTitle(":pencil: Transcript Ticket Chiuso")
        .setDescription(`**Ticket:** ${channel.name}\n**Chiuso da:** ${closedBy}\n**Motivo:** ${reason}\n**Categoria:** ${this.getCategoryName(channel)}`)
        .setColor(0x00ff00)
        .setTimestamp();

      await staffChannel.send({
        embeds: [embed],
        files: [{
          attachment: buffer,
          name: fileName
        }]
      });

    } catch (error) {
      console.error("[ticket] Errore invio transcript allo staff:", error);
    }
  }

  async closeTicket(channel, user, reason) {
    try {
      // Prima salva la transcript
      const transcript = await this.generateTranscript(channel);

      // Log della chiusura nel canale specifico per i ticket
      const logEmbed = new EmbedBuilder()
        .setTitle("Ticket Chiuso")
        .setDescription(`**Canale:** ${channel.name}\n**Chiuso da:** ${user}\n**Motivo:** ${reason}`)
        .setColor(0xff0000)
        .setTimestamp();

      const guildConfig = this.getGuildConfig(channel.guild);
      const ticketData = this.resolveTicketData(channel);
      const categoryConfig = ticketData?.category ? this.getTicketCategorySettings(guildConfig, ticketData.category) : null;
      const ticketLogChannelId = categoryConfig?.logChannelId || guildConfig.ticketLogChannelId;
      if (ticketLogChannelId) {
        const ticketLogChannel = await channel.guild.channels.fetch(ticketLogChannelId).catch(() => null);
        if (ticketLogChannel && ticketLogChannel.isTextBased()) {
          await ticketLogChannel.send({ embeds: [logEmbed] });
        }
      }

      // Invia transcript al canale staff
      await this.sendTranscriptToStaff(channel, transcript, user, reason);

      // Rimuovi dalla mappa attiva
      this.activeTickets.delete(channel.id);

      // Invia messaggio di chiusura
      const closeEmbed = new EmbedBuilder()
        .setTitle("Ticket Chiuso")
        .setDescription("Questo ticket verrà  eliminato in 3 secondi...")
        .setColor(0xff0000);

      await channel.send({ embeds: [closeEmbed] });

      // Attendi 3 secondi prima di eliminare il canale
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Elimina il canale
      try {
        await channel.delete();
        console.log(`[ticket] Canale ${channel.name} eliminato con successo.`);
      } catch (error) {
        console.error("[ticket] Errore eliminazione canale:", error);
      }

    } catch (error) {
      console.error("[ticket] Errore chiusura ticket:", error);
    }
  }

  // Metodo per ottenere statistiche
  getStats() {
    return {
      activeTickets: this.activeTickets.size,
      totalTickets: [...this.ticketCounters.values()].reduce((total, count) => total + count, 0)
    };
  }
}

module.exports = { TicketSystem };
