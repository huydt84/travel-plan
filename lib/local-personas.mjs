export const LOCAL_PERSONA_COOKIE = "travel-plan-local-persona";
export const LOCAL_PERSONA_TRIP_SLUG = "local-permission-lab";

export const LOCAL_PERSONAS = Object.freeze([
  { id: "owner", email: "local-admin@localhost.invalid", name: "Local Owner", globalRole: "owner", membership: "none", capability: "Toàn quyền hệ thống và override mọi chuyến trong Admin." },
  { id: "admin", email: "local-admin-user@localhost.invalid", name: "Local Admin", globalRole: "admin", membership: "none", capability: "Override trong Admin; tracker chính vẫn lọc theo membership." },
  { id: "leader", email: "local-leader@localhost.invalid", name: "Local Leader", globalRole: "member", membership: "leader", capability: "Quản lý lịch và thành viên của chuyến demo." },
  { id: "member", email: "local-member@localhost.invalid", name: "Local Member", globalRole: "member", membership: "member", capability: "Xem lịch, danh sách tên, góp ý và chọn nhánh." },
  { id: "outsider", email: "local-outsider@localhost.invalid", name: "Local Outsider", globalRole: "member", membership: "none", capability: "Đã đăng ký nhưng không biết hoặc truy cập được chuyến demo." },
  { id: "anonymous", email: null, name: "Anonymous", globalRole: "anonymous", membership: "none", capability: "Không đăng nhập; chỉ thấy màn hình truy cập." },
]);

export const LOCAL_PERSONA_BY_ID = new Map(LOCAL_PERSONAS.map((persona) => [persona.id, persona]));

export function localPersonaById(id) {
  return LOCAL_PERSONA_BY_ID.get(String(id || "").trim()) || null;
}

export function localPersonaIdForViewer(viewer) {
  if (!viewer?.email) return "anonymous";
  return LOCAL_PERSONAS.find((persona) => persona.email === viewer.email.toLowerCase())?.id || null;
}

export function resolveLocalViewerSelection({ localAdminViewer, headerEmail, anonymousHeader, personaCookie }) {
  const email = String(headerEmail || "").trim().toLowerCase();
  if (email) return { email, name: email.split("@")[0], source: "header" };
  if (String(anonymousHeader || "").trim() === "1") return null;
  if (personaCookie !== undefined && personaCookie !== null && personaCookie !== "") {
    const persona = localPersonaById(personaCookie);
    if (!persona?.email) return null;
    return { email: persona.email, name: persona.name, source: "cookie" };
  }
  return { email: localAdminViewer.email, name: localAdminViewer.name, source: "default" };
}
