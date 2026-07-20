import { Events, type VoiceState } from "discord.js";
import { logVoice } from "../modules/serverLog.js";
import { updateVoiceState } from "../store/voiceState.js";
import { enforceVoiceLock } from "../modules/voiceLockEnforce.js";

export const name = Events.VoiceStateUpdate;

export async function execute(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  await enforceVoiceLock(oldState, newState); // กัน admin bypass ห้องที่ล็อก (เตะออกทันที)
  updateVoiceState(oldState, newState); // อัปเดตสถานะปัจจุบันสำหรับ dashboard
  await logVoice(oldState, newState); // log เหตุการณ์
}
