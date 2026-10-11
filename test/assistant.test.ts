/**
 * ผู้ช่วย AI หน้าแชท — tool loop, การเก็บประวัติแบบ append-only, propose_action ไม่ลงมือจริง
 * ใช้ Anthropic client ปลอม ไม่ยิง API จริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botchat-")), "test.db");

const chat = await import("../src/store/chatStore.js");
const assistant = await import("../src/modules/serverAssistant.js");
const { addLog } = await import("../src/store/logStore.js");

const discord = { guilds: { cache: { get: () => null, first: () => null } }, users: { fetch: async () => ({ tag: "x" }) } } as unknown as Client;

/** client ปลอม: ตอบตามลำดับ responses และจด messages ที่ถูกส่งไปแต่ละรอบ */
function fakeAnthropic(responses: unknown[]) {
  const calls: { messages: unknown[] }[] = [];
  assistant.__setAnthropicForTest({
    beta: {
      messages: {
        create: async (params: { messages: unknown[] }) => {
          calls.push({ messages: structuredClone(params.messages) });
          const r = responses.shift();
          if (!r) throw new Error("ไม่มี response เหลือ");
          return r;
        },
      },
    },
  });
  return calls;
}

const toolUse = (id: string, name: string, input: unknown) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const answer = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

test("thread: เป็นของเจ้าของคนเดียว ลบแล้วข้อความหายด้วย", () => {
  const t = chat.createThread("alice", "หัวข้อ");
  chat.appendMessages(t.id, [{ role: "user", content: "hi" }]);
  assert.ok(chat.getThread(t.id, "alice"));
  assert.equal(chat.getThread(t.id, "bob"), undefined, "admin คนอื่นต้องเปิดไม่ได้");
  assert.equal(chat.deleteThread(t.id, "bob"), false);
  assert.equal(chat.deleteThread(t.id, "alice"), true);
  assert.deepEqual(chat.getMessages(t.id), []);
});

test("assistant: วน tool แล้วตอบ — เก็บครบทุกข้อความตามลำดับ และตาถัดไปส่งประวัติเดิมไม่แก้", async () => {
  await addLog("alert", "security", "security_ai", "AI ตรวจพบข้อความ toxic", [{ name: "User", value: "u (111)" }]);
  const calls = fakeAnthropic([
    toolUse("t1", "search_logs", { events: ["security_ai"], limit: 5 }),
    answer("มี 1 รายการ"),
    answer("ตอบคำถามที่สอง"),
  ]);
  const t = chat.createThread("alice", "x");
  await assistant.runAssistantTurn(discord, t.id, "AI จับอะไรบ้าง");

  const saved = chat.getMessages(t.id);
  assert.deepEqual(saved.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  const result = (saved[2]!.content as { type: string; content: string }[])[0]!;
  assert.equal(result.type, "tool_result");
  assert.match(result.content, /security_ai/);

  await assistant.runAssistantTurn(discord, t.id, "คำถามที่สอง");
  // รอบที่สามต้องเริ่มด้วยประวัติ 4 ข้อความเดิมเป๊ะ ๆ (append-only)
  assert.deepEqual(calls[2]!.messages.slice(0, 4), saved);
  assert.equal(chat.getMessages(t.id).length, 6);
});

test("assistant: propose_action ไม่ลงมือ คืนสถานะรอ admin / input ผิด = is_error", async () => {
  const ok = JSON.parse(
    await assistant.runTool(discord, "propose_action", { action: "ban", user_id: "123456789012345678", reason: "spam" }),
  );
  assert.match(ok.status, /รอ admin/);
  await assert.rejects(assistant.runTool(discord, "propose_action", { action: "nuke", user_id: "1", reason: "x" }));

  fakeAnthropic([toolUse("t2", "propose_action", { action: "ban", user_id: "abc", reason: "x" }), answer("ขอโทษ")]);
  const t = chat.createThread("alice", "y");
  await assistant.runAssistantTurn(discord, t.id, "แบนเลย");
  const res = (chat.getMessages(t.id)[2]!.content as { is_error?: boolean }[])[0]!;
  assert.equal(res.is_error, true);
});

test("assistant: API พังกลางทาง → ไม่บันทึกอะไรครึ่ง ๆ กลาง ๆ", async () => {
  fakeAnthropic([toolUse("t3", "server_overview", {})]); // รอบสองไม่มี response = throw
  const t = chat.createThread("alice", "z");
  await assert.rejects(assistant.runAssistantTurn(discord, t.id, "สรุปหน่อย"));
  assert.deepEqual(chat.getMessages(t.id), []);
});

test("assistant: action ที่ admin ตัดสินแล้วบันทึกครั้งเดียว (กดซ้ำไม่ทับ)", () => {
  const t = chat.createThread("alice", "a");
  chat.setActionStatus({ tool_use_id: "p1", thread_id: t.id, status: "done", result: "แบนแล้ว", decided_by: "alice" });
  chat.setActionStatus({ tool_use_id: "p1", thread_id: t.id, status: "dismissed", result: null, decided_by: "alice" });
  assert.equal(chat.getActions(t.id).get("p1")?.status, "done");
});
