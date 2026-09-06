import pg from "pg";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect,test } from "./fixtures.mjs";

test("management migration preserves unknown historical settings and gates old SQL acceptance",async()=>{
  const client=new pg.Client({connectionString:DEFAULT_LOCAL_POSTGRES_URI});await client.connect();
  const schema=`management_test_${randomUUID().replaceAll("-","")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
    await client.query("SELECT set_config('app.migration_owner','owner@example.com',false)");
    const files=(await readdir("migrations")).filter(f=>/^\d.*\.mjs$/.test(f)).sort();
    const target=files.indexOf("1788998400000_assistant-management.mjs");
    for(const file of files.slice(0,target)) await (await import(`../../migrations/${file}`)).up({db:client});
    await client.query("INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES('admin@example.com','Admin','admin',NOW(),NOW(),NOW())");
    const trip=(await client.query("INSERT INTO trips(slug,title,trip_date,end_date,timezone,location) VALUES('legacy','Legacy','2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING id")).rows[0];
    const conversation=randomUUID(),turn=randomUUID();
    await client.query("INSERT INTO assistant_conversations(id,owner_email,trip_id,title) VALUES($1,'admin@example.com',$2,'History')",[conversation,trip.id]);
    await client.query("INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status) VALUES($1,$2,$3,'Old question','Old answer','completed')",[turn,conversation,randomUUID()]);
    await (await import(`../../migrations/${files[target]}`)).up({db:client});
    expect((await client.query("SELECT execution_settings,output_text FROM assistant_turns WHERE id=$1",[turn])).rows[0]).toEqual({execution_settings:null,output_text:"Old answer"});
    const accept=()=>client.query("SELECT accept_assistant_background_request('admin@example.com','legacy',NULL,$1,'Old endpoint','Legacy',$2,$3,60000,30,NULL) AS result",[randomUUID(),randomUUID(),randomUUID()]);
    const accepted=(await accept()).rows[0].result;expect(accepted.error).toBeUndefined();
    expect((await client.query("SELECT execution_settings FROM assistant_turns WHERE id=$1",[accepted.turnId])).rows[0].execution_settings.effort).toBe("default");
    await client.query("UPDATE assistant_policy_defaults SET policy=jsonb_set(policy,'{enabled}','false')");
    // Re-adopting an installation must preserve owner policy and captured settings.
    await (await import(`../../migrations/${files[target]}`)).up({db:client});
    expect((await client.query("SELECT policy FROM assistant_policy_defaults")).rows[0].policy.enabled).toBe(false);
    expect((await client.query("SELECT execution_settings FROM assistant_turns WHERE id=$1",[turn])).rows[0].execution_settings).toBeNull();
    await expect(accept()).rejects.toMatchObject({code:"PA001"});
    expect((await client.query("SELECT assistant_effective_policy('owner@example.com') AS p")).rows[0].p.enabled).toBe(true);
  }finally{await client.query("SET search_path TO public");await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
});
