import { Events, MessageFlags, type Interaction } from "discord.js";
import { commands } from "../commands/index.js";
import {
  IDCARD_BUTTON,
  IDCARD_MODAL,
  showIdcardModal,
  submitIdcard,
} from "../idcard/idcardSetup.js";
import {
  CANCEL_ID,
  CONFIRM_PREFIX,
  SELECT_ID,
  handleRoleButton,
  handleRoleSelect,
} from "../commands/deleterole.js";

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
  try {
    // ปุ่ม: สร้างบัตร / ยืนยัน-ยกเลิกลบ role
    if (interaction.isButton()) {
      if (interaction.customId === IDCARD_BUTTON) await showIdcardModal(interaction);
      else if (
        interaction.customId === CANCEL_ID ||
        interaction.customId.startsWith(CONFIRM_PREFIX)
      )
        await handleRoleButton(interaction);
      return;
    }
    // dropdown เลือก role ที่จะลบ -> โชว์ปุ่มยืนยัน
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === SELECT_ID) await handleRoleSelect(interaction);
      return;
    }
    // กรอก modal เสร็จ -> สร้างบัตร
    if (interaction.isModalSubmit()) {
      if (interaction.customId === IDCARD_MODAL) await submitIdcard(interaction);
      return;
    }
    // autocomplete -> ให้คำสั่งเติมรายชื่อตัวเลือก (เช่น role ให้ /deleterole)
    // ต้องตอบให้ทันภายใน 3 วิ และห้าม throw ออกไป ไม่งั้นช่องตัวเลือกจะค้างว่าง
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) {
        try {
          await cmd.autocomplete(interaction);
        } catch (err) {
          console.error("autocomplete ผิดพลาด:", err);
          if (!interaction.responded) await interaction.respond([]).catch(() => {});
        }
      }
      return;
    }
    // slash command
    if (!interaction.isChatInputCommand()) return;
    const command = commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (err) {
    console.error("interaction ผิดพลาด:", err);
    if (interaction.isRepliable()) {
      // as const จำเป็น — ไม่งั้น flags ถูกกว้างเป็น MessageFlags ทั้ง enum
      // ซึ่งไม่ตรงกับ BitFieldResolvable ที่ reply/followUp รับ
      const msg = {
        content: "❌ เกิดข้อผิดพลาด",
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  }
}
