import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_PERSONAS, localPersonaById, localPersonaIdForViewer, resolveLocalViewerSelection } from "../lib/local-personas.mjs";

const localOwner = { email: "local-admin@localhost.invalid", name: "Local Admin" };

test("local persona catalog has stable unique identities and only anonymous lacks an email", () => {
  assert.equal(new Set(LOCAL_PERSONAS.map((persona) => persona.id)).size, LOCAL_PERSONAS.length);
  assert.equal(new Set(LOCAL_PERSONAS.filter((persona) => persona.email).map((persona) => persona.email)).size, LOCAL_PERSONAS.length - 1);
  assert.equal(localPersonaById("anonymous").email, null);
  assert.equal(localPersonaById("missing"), null);
});

test("local viewer selection honors email, anonymous, cookie, fallback precedence", () => {
  assert.deepEqual(resolveLocalViewerSelection({ localAdminViewer: localOwner, headerEmail: "Leader@Example.com", anonymousHeader: "1", personaCookie: "member" }), {
    email: "leader@example.com", name: "leader", source: "header",
  });
  assert.equal(resolveLocalViewerSelection({ localAdminViewer: localOwner, anonymousHeader: "1", personaCookie: "leader" }), null);
  assert.deepEqual(resolveLocalViewerSelection({ localAdminViewer: localOwner, personaCookie: "member" }), {
    email: "local-member@localhost.invalid", name: "Local Member", source: "cookie",
  });
  assert.equal(resolveLocalViewerSelection({ localAdminViewer: localOwner, personaCookie: "forged" }), null);
  assert.deepEqual(resolveLocalViewerSelection({ localAdminViewer: localOwner }), {
    email: localOwner.email, name: localOwner.name, source: "default",
  });
});

test("viewer identity maps back to a persona without inventing matches", () => {
  assert.equal(localPersonaIdForViewer(null), "anonymous");
  assert.equal(localPersonaIdForViewer({ email: "LOCAL-LEADER@LOCALHOST.INVALID" }), "leader");
  assert.equal(localPersonaIdForViewer({ email: "fixture@example.com" }), null);
});
