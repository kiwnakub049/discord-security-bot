import { Events, type Interaction } from "discord.js";
import { commands } from "../commands/index.js";
import {
  IDCARD_BUTTON,
  IDCARD_MODAL,
  showIdcardModal,
  submitIdcard,
} from "../idcard/idcardSetup.js";

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
  try {
    // ปุ่มสร้างบัตร -> เปิด modal
    if (interaction.isButton()) {
      if (interaction.customId === IDCARD_BUTTON) await showIdcardModal(interaction);
      return;
    }
    // กรอก modal เสร็จ -> สร้างบัตร
    if (interaction.isModalSubmit()) {
      if (interaction.customId === IDCARD_MODAL) await submitIdcard(interaction);
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
      const msg = { content: "❌ เกิดข้อผิดพลาด", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  }
}
