import { Events, type GuildMember, type PartialGuildMember } from "discord.js";
import { logMemberLeave } from "../modules/serverLog.js";

export const name = Events.GuildMemberRemove;

export async function execute(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  await logMemberLeave(member);
}
