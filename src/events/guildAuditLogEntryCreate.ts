import { Events, type Guild, type GuildAuditLogsEntry } from "discord.js";
import { logAuditEntry } from "../modules/serverLog.js";

export const name = Events.GuildAuditLogEntryCreate;

export async function execute(
  entry: GuildAuditLogsEntry,
  guild: Guild,
): Promise<void> {
  await logAuditEntry(entry, guild);
}
