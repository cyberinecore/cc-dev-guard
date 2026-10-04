import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dangerReason } from "../scripts/lib/dangerguard.mjs";
import { ALLOWS, CASE_HOME as home, DENIES, DEVGUARD_ALLOWS, DEVGUARD_DENIES } from "./fixtures/bashguard-cases.mjs";

test("every deny case of the Go bash guard's TestBashGuardDenies is denied", () => {
  for (const c of DENIES) assert.notEqual(dangerReason(c, { home }), "", `expected deny for ${JSON.stringify(c)}`);
});

test("every allow case of the Go bash guard's TestBashGuardAllows passes", () => {
  for (const c of ALLOWS) assert.equal(dangerReason(c, { home }), "", `expected allow for ${JSON.stringify(c)}`);
});

test("text-only heredoc bodies, lowercase truncate outside SQL and $(mktemp) targets pass (divergences from the Go table)", () => {
  for (const c of DEVGUARD_ALLOWS) assert.equal(dangerReason(c, { home }), "", `expected allow for ${JSON.stringify(c)}`);
});

test("heredocs fed to a shell or SQL client, SQL truncate and climbing $(mktemp) targets still deny", () => {
  for (const c of DEVGUARD_DENIES) assert.notEqual(dangerReason(c, { home }), "", `expected deny for ${JSON.stringify(c)}`);
});

test("protected branches come from the option", () => {
  assert.equal(dangerReason("git push -f origin feature/abc-12", { home, protectedBranches: ["feature/abc-12"] }), "force-push to protected branch `feature/abc-12` is denied.");
  assert.equal(dangerReason("git push -f origin main", { home, protectedBranches: ["trunk"] }), "");
  assert.notEqual(dangerReason("git push -f", { home, protectedBranches: [] }), "");
});

test("aws s3 deletes are denied only while the option is on", () => {
  assert.notEqual(dangerReason("aws s3 rm s3://bucket/key", { home }), "");
  assert.equal(dangerReason("aws s3 rm s3://bucket/key", { home, awsS3: false }), "");
  assert.equal(dangerReason("aws s3api delete-bucket --bucket b", { home, awsS3: false }), "");
});

test("an empty or non-string command passes", () => {
  assert.equal(dangerReason("", { home }), "");
  assert.equal(dangerReason(undefined, { home }), "");
});
