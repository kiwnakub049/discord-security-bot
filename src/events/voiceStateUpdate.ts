import { Events, type VoiceState } from "discord.js";
import { logVoice } from "../modules/serverLog.js";
import { updateVoiceState } from "../store/voiceState.js";
import { enforceVoiceLock } from "../modules/voiceLockEnforce.js";
import { trackVoiceActivity } from "../modules/voiceActivity.js";
import { logEvent } from "../utils/logger.js";

export const name = Events.VoiceStateUpdate;

export async function execute(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  await enforceVoiceLock(oldState, newState); // กัน admin bypass ห้องที่ล็อก (เตะออกทันที)
  updateVoiceState(oldState, newState); // อัปเดตสถานะปัจจุบันสำหรับ dashboard
  const xp = trackVoiceActivity(oldState, newState); // สะสมเวลาห้องเสียงเป็น XP
  if (xp?.leveledUp) {
    const user = newState.member?.user;
    await logEvent(newState.guild.client, "info", "member", "member_levelup", "เลื่อนเลเวล!", [
      { name: "User", value: user ? `${user.tag} (${user.id})` : xp.userId },
      { name: "เลเวล", value: `${xp.oldLevel} → ${xp.newLevel}` },
      { name: "จาก", value: "ห้องเสียง" },
    ]);
  }
  await logVoice(oldState, newState); // log เหตุการณ์
}
