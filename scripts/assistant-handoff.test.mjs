import assert from "node:assert/strict";
import test from "node:test";
import { matchesAssistantHandoffTrigger } from "../lib/v1/assistant-handoff.mjs";
import { AssistantHandoffEmailError, buildAssistantHandoffEmail, buildAssistantHandoffUrl, sendAssistantHandoffEmail } from "../lib/assistant-handoff-email.mjs";

test("handoff trigger matches exact Vietnamese substrings across casing, punctuation, and NFC composition", () => {
  for (const input of ["Chồng iu", "CHỒNG YÊU!", "này, vợ iu nhé", "VỢ YÊU", "chồng yêu dấu", `Chồng iu`]) {
    assert.equal(matchesAssistantHandoffTrigger(input), true, input);
  }
});

test("handoff trigger does not accent-fold or fuzzy match", () => {
  for (const input of ["chong iu", "vo yeu", "vợ thương", "chồngi u", ""]) {
    assert.equal(matchesAssistantHandoffTrigger(input), false, input);
  }
  assert.equal(matchesAssistantHandoffTrigger(null), false);
});

const env = { APP_URL: "https://travel.example/base?old=1#old", AUTH_OWNER_EMAIL: "OWNER@example.com", RESEND_API_KEY: "re_test" };
const row = { handoff_id: "3d594650-3436-47ca-a9c7-65f569ef189f", recipient_email: "wrong@example.com",
  sender_name: "An & Bình", sender_email: "an@example.com", conversation_title: "Tokyo <script>",
  message_body: "Chồng yêu <script>alert('x')</script>\nMở nhé" };

test("handoff email uses the configured owner, safe deep link, and escaped HTML", () => {
  assert.equal(buildAssistantHandoffUrl(env,row.handoff_id),`https://travel.example/admin/assistant/handoffs/${row.handoff_id}`);
  const email=buildAssistantHandoffEmail(row,env);
  assert.deepEqual(email.to,["owner@example.com"]);
  assert.match(email.text,/<script>alert/);
  assert.doesNotMatch(email.html,/<script>/);
  assert.match(email.html,/&lt;script&gt;/);
});

test("handoff Resend request has a stable per-handoff idempotency key", async () => {
  const requests=[];
  const id=await sendAssistantHandoffEmail(row,{env,fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({id:"email-1"})};}});
  assert.equal(id,"email-1");
  assert.equal(requests[0].url,"https://api.resend.com/emails");
  assert.equal(requests[0].options.headers["Idempotency-Key"],`assistant-handoff/${row.handoff_id}`);
});

test("handoff Resend endpoint overrides are limited to local admin loopback", async () => {
  await assert.rejects(()=>sendAssistantHandoffEmail(row,{env:{...env,RESEND_API_ENDPOINT:"https://elsewhere.example/emails"},fetchImpl:async()=>({ok:true,json:async()=>({id:"bad"})})}),
    error=>error instanceof AssistantHandoffEmailError && error.code==="RESEND_CONFIG_ERROR");
  const local={...env,NODE_ENV:"development",LOCAL_ADMIN_BYPASS:"true",RESEND_API_ENDPOINT:"http://127.0.0.1:3101/emails"};
  let endpoint="";
  await sendAssistantHandoffEmail(row,{env:local,fetchImpl:async(url)=>{endpoint=url;return {ok:true,json:async()=>({id:"local"})};}});
  assert.equal(endpoint,local.RESEND_API_ENDPOINT);
});
