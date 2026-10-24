import { test } from "node:test";
import assert from "node:assert/strict";
import { digits, isFromHost } from "../src/integrations/phone";

test("digits keeps 0-9 only", () => assert.equal(digits("+1 (555) 123-4567"), "15551234567"));
test("isFromHost matches on last 10 digits", () => {
  assert.equal(isFromHost("+1 (555) 123-4567", "5551234567"), true);
  assert.equal(isFromHost("+15550000001", "+15551234567"), false);
});
