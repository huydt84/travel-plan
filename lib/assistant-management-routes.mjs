export const assistantRoot = "/admin/assistant";
export const userPath = email => `${assistantRoot}/users/${encodeURIComponent(email)}`;
export const historyPath = email => `${userPath(email)}/conversations`;
export const conversationPath = id => `${assistantRoot}/conversations/${id}`;
export const requestPath = (id,turn) => `${conversationPath(id)}/turns/${turn}`;
export const failurePath = id => `${assistantRoot}/failures/${id}`;
export const handoffPath = id => `${assistantRoot}/handoffs/${id}`;
