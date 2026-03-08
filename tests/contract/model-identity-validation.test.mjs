import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAssignedTo,
  validateModelIdentity,
} from "../../build/shared/failure-validator.js";

test("model identity accepts codex/claude/gemini tiered formats", () => {
  assert.equal(validateModelIdentity("codex.5.3.low").valid, true);
  assert.equal(validateModelIdentity("codex.5.3.mid").valid, true);
  assert.equal(validateModelIdentity("codex.5.3.high").valid, true);
  assert.equal(validateModelIdentity("codex.5.3.xhigh").valid, true);

  assert.equal(validateModelIdentity("claude.opus.4.6.fast").valid, true);
  assert.equal(validateModelIdentity("claude.opus.4.6.think").valid, true);
  assert.equal(validateModelIdentity("claude.sonnet.4.6.fast").valid, true);
  assert.equal(validateModelIdentity("claude.sonnet.4.6.std").valid, true);

  assert.equal(validateModelIdentity("gemini.2.5.low").valid, true);
  assert.equal(validateModelIdentity("gemini.2.5.high").valid, true);
});

test("assigned_to validation supports tiered identities and warns on partial forms", () => {
  // Full tiered identities still accepted
  assert.equal(validateAssignedTo("dev.minimart.codex.5.3.mid").valid, true);
  assert.equal(validateAssignedTo("dev.minimart.claude.sonnet.4.6.std").valid, true);
  assert.equal(validateAssignedTo("mini.minimart.gemini.2.5.high").valid, true);

  // dev.minimart is a canonical team-queue shorthand — valid with no warning
  const missingModel = validateAssignedTo("dev.minimart");
  assert.equal(missingModel.valid, true);
  assert.equal(missingModel.warning, undefined);

  // Freeform model names now accepted (PA-186) — no strict tier validation
  assert.equal(validateAssignedTo("dev.minimart.sonnet").valid, true);
  assert.equal(validateAssignedTo("dev.minimart.mcminicky").valid, true);
  assert.equal(validateAssignedTo("dev.minimart.gpt").valid, true);
  assert.equal(validateAssignedTo("dev.minimart.claude.sonnet.4.6.ultra").valid, true);

  // Still reject structurally invalid forms
  assert.equal(validateAssignedTo("bad.minimart.sonnet").valid, false);
  assert.equal(validateAssignedTo("totally-wrong").valid, false);
});
