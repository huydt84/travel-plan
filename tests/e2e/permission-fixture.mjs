import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, test as base } from "./fixtures.mjs";

export const anonymousHeaders = { "x-local-viewer-anonymous": "1" };

export const permissionTest = base.extend({
  permissionFixture: async ({ request }, provideFixture) => {
    const marker = randomUUID();
    const people = {
      owner: { email: "local-admin@localhost.invalid", name: "Local Owner" },
      admin: { email: `matrix-admin-${marker}@example.com`, name: "Matrix Admin" },
      leader: { email: `matrix-leader-${marker}@example.com`, name: "Matrix Leader" },
      member: { email: `matrix-member-${marker}@example.com`, name: "Matrix Member" },
      outsider: { email: `matrix-outsider-${marker}@example.com`, name: "Matrix Outsider" },
      invitee: { email: `matrix-invitee-${marker}@example.com`, name: "Matrix Invitee" },
      anonymous: { email: null, name: "Anonymous" },
    };
    const headers = Object.fromEntries(Object.entries(people).map(([id, person]) => [id,
      id === "anonymous" ? anonymousHeaders : { "x-local-viewer-email": person.email, "x-local-viewer-name": person.name },
    ]));
    const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
    const slug = `permission-matrix-${marker}`;
    try {
      for (const id of ["admin", "leader", "member", "outsider", "invitee"]) {
        expect((await request.get("/api/trips", { headers: headers[id] })).status()).toBe(200);
      }
      await sql`UPDATE users SET role='admin' WHERE email=${people.admin.email}`;
      const created = await request.post("/api/trips", { headers: headers.leader, data: {
        slug, title: "Permission matrix trip", startDate: "2032-04-01", endDate: "2032-04-01",
        timezone: "Asia/Tokyo", location: "Tokyo", memberEmails: [people.member.email],
      } });
      expect(created.status()).toBe(201);
      for (const [index, title] of ["Matrix start", "Matrix segment", "Matrix rejoin"].entries()) {
        expect((await request.post(`/api/trips/${slug}/schedule`, { headers: headers.leader, data: {
          startDate: "2032-04-01", start: `${String(9 + index).padStart(2, "0")}:00`,
          endDate: "2032-04-01", end: `${String(10 + index).padStart(2, "0")}:00`,
          type: "Visit", icon: "📍", title, detail: "Permission fixture", refs: [],
        } })).status()).toBe(201);
      }
      const plan = await (await request.get(`/api/trips/${slug}`, { headers: headers.leader })).json();
      await provideFixture({ marker, slug, people, headers, sql, plan });
    } finally {
      await request.delete(`/api/trips/${slug}`, { headers: headers.owner });
      await sql`DELETE FROM users WHERE email=ANY(${Object.values(people).map((person) => person.email).filter((email) => email && email !== people.owner.email)}::TEXT[])`;
      await sql.end();
    }
  },
});

export { expect };
