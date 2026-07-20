import {
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { lock, unlock } from "./lockdown.js";
import { status } from "./status.js";
import {
  idcard,
  issue,
  register,
  setbias,
  setstatus,
  setupIdcard,
  syncCardRoles,
} from "./idcard.js";
import { clearwarnings, warn, warnings } from "./warnings.js";
import { lockVoice, unlockVoice } from "./voicelock.js";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// รวมทุกคำสั่งไว้ที่นี่ — เพิ่มคำสั่งใหม่แค่ import แล้วใส่ใน array
const list: Command[] = [
  lock,
  unlock,
  status,
  register,
  idcard,
  setbias,
  setstatus,
  issue,
  setupIdcard,
  syncCardRoles,
  warn,
  warnings,
  clearwarnings,
  lockVoice,
  unlockVoice,
];

export const commands = new Map<string, Command>(
  list.map((c) => [c.data.name, c]),
);
