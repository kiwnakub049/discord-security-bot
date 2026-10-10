/**
 * ทดสอบการอัปโหลดแบบซอยก้อน
 *
 * ที่ต้องมี: ไฟล์ถูกต่อกลับจากหลายคำขอ ถ้าลำดับเพี้ยนหรือมีรูโหว่ จะได้ zip
 * ที่ขนาดดูถูกแต่ข้างในพัง ซึ่งจะไปโผล่เป็น "ผู้เล่นโหลดม็อดไม่ได้" ทีหลัง
 * โดยไม่มีอะไรบอกว่าต้นเหตุอยู่ตรงนี้
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const dir = mkdtempSync(join(tmpdir(), "beammp-up-"));
mkdirSync(join(dir, "Resources", "Client"), { recursive: true });
process.env.BEAMMP_DIR = dir;

const { beginUpload, writeChunk, finishUpload, abortUpload, pendingCount } =
  await import("../src/beammp/uploads.js");

function stream(data: Buffer): Readable {
  return Readable.from([data]);
}

test("ต่อไฟล์จากหลายก้อนได้ตรงต้นฉบับทุกไบต์", async () => {
  const original = Buffer.concat([
    Buffer.from("PK\x03\x04"),
    Buffer.from("ก้อนหนึ่ง-"),
    Buffer.from("ก้อนสอง-"),
    Buffer.from("ก้อนสาม"),
  ]);
  const b = beginUpload("test.zip");
  assert.ok(b.ok);

  let offset = 0;
  for (const size of [10, 20, original.length - 30]) {
    const part = original.subarray(offset, offset + size);
    const r = await writeChunk(b.id, offset, stream(part), part.length);
    assert.ok(r.ok, `ก้อนที่ offset ${offset} ต้องผ่าน`);
    offset += size;
  }

  const fin = finishUpload(b.id);
  assert.ok(fin.ok);
  assert.deepEqual(readFileSync(fin.partPath), original, "ต้องตรงทุกไบต์");
});

test("ก้อนที่มา offset ผิด ถูกปฏิเสธ ไม่ใช่เขียนทับมั่ว", async () => {
  const b = beginUpload("x.zip");
  assert.ok(b.ok);
  await writeChunk(b.id, 0, stream(Buffer.from("PK1234")), 6);

  // ข้ามไป — จะทำให้เกิดรูโหว่กลางไฟล์
  const skip = await writeChunk(b.id, 999, stream(Buffer.from("zzz")), 3);
  assert.equal(skip.ok, false);

  // ย้อนกลับ — จะทำให้เขียนทับของเดิม
  const back = await writeChunk(b.id, 0, stream(Buffer.from("zzz")), 3);
  assert.equal(back.ok, false);

  abortUpload(b.id);
});

test("id ที่ไม่มีจริง ไม่ทำให้พัง", async () => {
  const r = await writeChunk("ไม่มีจริง", 0, stream(Buffer.from("x")), 1);
  assert.equal(r.ok, false);
  assert.equal(finishUpload("ไม่มีจริง").ok, false);
});

test("abort ลบไฟล์ค้างทิ้ง", async () => {
  const b = beginUpload("drop.zip");
  assert.ok(b.ok);
  await writeChunk(b.id, 0, stream(Buffer.from("PKxxxx")), 6);
  const before = pendingCount();
  abortUpload(b.id);
  assert.equal(pendingCount(), before - 1, "เซสชันต้องหายไป");
});

test("ชื่อไฟล์ที่รับไม่ได้ ถูกปัดตกตั้งแต่ begin ไม่ใช่ตอนส่งจบ", () => {
  assert.equal(beginUpload("evil.sh").ok, false);
  assert.equal(beginUpload("../../x.zip").ok, true); // basename ตัดให้เหลือ x.zip
});

test("แต่ละครั้งได้ id คนละอัน — สองคนอัปชื่อเดียวกันพร้อมกันไม่ปนกัน", async () => {
  const a = beginUpload("same.zip");
  const b = beginUpload("same.zip");
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.id, b.id);

  await writeChunk(a.id, 0, stream(Buffer.from("PKaaaa")), 6);
  await writeChunk(b.id, 0, stream(Buffer.from("PKbbbb")), 6);

  const fa = finishUpload(a.id);
  const fb = finishUpload(b.id);
  assert.ok(fa.ok && fb.ok);
  assert.notEqual(fa.partPath, fb.partPath, "ไฟล์ชั่วคราวต้องคนละไฟล์");
  assert.equal(readFileSync(fa.partPath).toString(), "PKaaaa");
  assert.equal(readFileSync(fb.partPath).toString(), "PKbbbb");
});

test("ไฟล์ว่างไม่ผ่านตอน finish", async () => {
  const b = beginUpload("empty.zip");
  assert.ok(b.ok);
  const r = finishUpload(b.id);
  assert.equal(r.ok, false);
  assert.ok(!existsSync(join(dir, "Resources", "Client", "empty.zip")));
});
