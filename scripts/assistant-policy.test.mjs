import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_MODELS, validatePolicy, initialModel } from "../lib/v1/assistant-policy.mjs";
import { createGeminiModelAdapter } from "../lib/v1/gemini-adapter.mjs";
import { createGoogleResearchAdapters } from "../lib/v1/research.mjs";
import { scriptedClient, call } from "./assistant-fixtures.mjs";
const policy = { enabled:true,daily:50,weekly:250,model:ASSISTANT_MODELS[0],effort:"high",version:0 };
test("policy validation rejects unsupported combinations and preserves explicit unlimited/inheritance", () => {
  assert.equal(initialModel("unknown"),"gemini-3.6-flash");
  for(const model of ASSISTANT_MODELS) assert.equal(initialModel(model),model);
  for(const change of [{ model:"gemini-pro" },{effort:"minimal"},{daily:0},{weekly:-1},{daily:1.5},{version:-1},{enabled:"true"},{extra:true},{model:"inherit"}]) assert.throws(() => validatePolicy({...policy,...change}));
  assert.equal(validatePolicy({...policy,daily:null}).daily,null);
  assert.equal(validatePolicy({...policy,daily:"inherit",model:"inherit",effort:"default"},true).daily,"inherit");
});
test("model and effort reach every planning continuation and web research call", async () => {
  for(const effort of ["default","high"]) {
    const requests=[];
    const client=scriptedClient([
      (r) => { requests.push(r);return {steps:[call("search_context",{})]}; },
      (r) => { requests.push(r);return {output_text:"Answer"}; },
    ]);
    await createGeminiModelAdapter({client,model:ASSISTANT_MODELS[0],effort}).run({message:"Search",actor:{email:"test@example.com",isAdmin:true},contextService:{search:async()=>({items:[]})}});
    for(const r of requests) { assert.equal(r.model,ASSISTANT_MODELS[0]); assert.deepEqual(r.generation_config,effort==="default" ? undefined : {thinking_level:"high"}); }
    const research=createGoogleResearchAdapters({geminiModel:ASSISTANT_MODELS[0],effort,searchClient:{interactions:{create:async(r)=>{ requests.push(r);return {output_text:"Research"}; }}}});
    await research.searchWeb({query:"Tokyo"},{});
    assert.deepEqual(requests.at(-1).generation_config,effort==="default" ? undefined : {thinking_level:"high"});
  }
});
