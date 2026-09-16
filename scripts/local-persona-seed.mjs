import { LOCAL_PERSONAS, LOCAL_PERSONA_TRIP_SLUG } from "../lib/local-personas.mjs";

export async function seedLocalPersonas(sql) {
  const registered = LOCAL_PERSONAS.filter((persona) => persona.email);
  const leader = LOCAL_PERSONAS.find((persona) => persona.id === "leader");
  const member = LOCAL_PERSONAS.find((persona) => persona.id === "member");
  await sql.transaction((tx) => [
    ...registered.map((persona) => tx`INSERT INTO users(email,name,display_name,role,first_login,last_login,last_active_at)
      VALUES(${persona.email},${persona.name},${persona.name},${persona.globalRole === "admin" ? "admin" : "member"},NOW(),NOW(),NOW())
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,display_name=EXCLUDED.display_name,role=EXCLUDED.role`),
    tx`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
      VALUES(${LOCAL_PERSONA_TRIP_SLUG},'Local permission lab','2031-06-01','2031-06-02','Asia/Tokyo','Tokyo')
      ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title,trip_date=EXCLUDED.trip_date,end_date=EXCLUDED.end_date,
        timezone=EXCLUDED.timezone,location=EXCLUDED.location`,
    tx`DELETE FROM trip_participants WHERE trip_id=(SELECT id FROM trips WHERE slug=${LOCAL_PERSONA_TRIP_SLUG})`,
    tx`INSERT INTO trip_participants(trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
      SELECT id,${leader.email},'leader',${leader.email},NOW(),NOW() FROM trips WHERE slug=${LOCAL_PERSONA_TRIP_SLUG}
      UNION ALL SELECT id,${member.email},'member',${leader.email},NOW(),NOW() FROM trips WHERE slug=${LOCAL_PERSONA_TRIP_SLUG}`,
  ], { isolationLevel: "Serializable" });
}
