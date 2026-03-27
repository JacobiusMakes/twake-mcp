#!/usr/bin/env node

/**
 * twake-mcp — MCP server for Twake Workplace
 *
 * Exposes Linagora's Twake Workplace (Chat, Mail, Drive) as MCP tools
 * that any AI assistant can use. This bridges the gap between Linagora's
 * collaboration suite and the AI ecosystem.
 *
 * Tools provided:
 *   - twake_chat_send: Send a message to a Twake Chat room
 *   - twake_chat_rooms: List joined chat rooms
 *   - twake_chat_history: Get recent messages from a room
 *   - twake_mail_inbox: List inbox emails
 *   - twake_mail_read: Read a specific email
 *   - twake_mail_mailboxes: List mail folders
 *   - twake_drive_list: List files and folders
 *   - twake_drive_read: Read a text file from Drive
 *   - twake_drive_upload: Upload content to Drive
 *   - twake_search: Search across all Twake services
 *
 * Configuration via environment variables:
 *   TWAKE_MATRIX_HOMESERVER, TWAKE_MATRIX_TOKEN, TWAKE_MATRIX_USER
 *   TWAKE_JMAP_URL, TWAKE_JMAP_TOKEN
 *   TWAKE_COZY_URL, TWAKE_COZY_TOKEN
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "crypto";

// ============================================================
//  API Clients (reuse twake-cli patterns)
// ============================================================

async function matrixFetch(endpoint, options = {}) {
  const homeserver = process.env.TWAKE_MATRIX_HOMESERVER;
  const token = process.env.TWAKE_MATRIX_TOKEN;
  if (!homeserver || !token) throw new Error("Matrix not configured");

  const url = `${homeserver}/_matrix/client/v3${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Matrix error ${res.status}: ${err.error || res.statusText}`);
  }
  return res.json();
}

async function jmapRequest(methodCalls) {
  const apiUrl = process.env.TWAKE_JMAP_URL;
  const token = process.env.TWAKE_JMAP_TOKEN;
  if (!apiUrl || !token) throw new Error("JMAP not configured");

  // Derive accountId from JWT
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  const email = payload.email || payload.sub;
  const accountId = createHash("sha256").update(email).digest("hex");

  const calls = methodCalls.map(([method, args, callId]) => [
    method,
    { accountId, ...args },
    callId,
  ]);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json;jmapVersion=rfc-8621",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: calls,
    }),
  });
  if (!res.ok) throw new Error(`JMAP error ${res.status}`);
  return (await res.json()).methodResponses;
}

async function cozyFetch(endpoint, options = {}) {
  const instanceUrl = process.env.TWAKE_COZY_URL;
  const token = process.env.TWAKE_COZY_TOKEN;
  if (!instanceUrl || !token) throw new Error("Cozy not configured");

  const res = await fetch(`${instanceUrl}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Cozy error ${res.status}`);
  return res.json();
}

// ============================================================
//  Tool Implementations
// ============================================================

async function chatSend({ room, message }) {
  const txnId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixFetch(`/rooms/${encodeURIComponent(room)}/send/m.room.message/${txnId}`, {
    method: "PUT",
    body: JSON.stringify({ msgtype: "m.text", body: message }),
  });
  return `Message sent to ${room}`;
}

async function chatRooms() {
  const data = await matrixFetch("/joined_rooms");
  const rooms = await Promise.all(
    (data.joined_rooms || []).map(async (roomId) => {
      try {
        const state = await matrixFetch(`/rooms/${encodeURIComponent(roomId)}/state/m.room.name`);
        return { id: roomId, name: state.name || "(unnamed)" };
      } catch {
        return { id: roomId, name: "(unnamed)" };
      }
    })
  );
  return rooms.map((r) => `${r.name}: ${r.id}`).join("\n") || "No rooms";
}

async function chatHistory({ room, limit = 20 }) {
  const data = await matrixFetch(
    `/rooms/${encodeURIComponent(room)}/messages?dir=b&limit=${limit}`
  );
  const messages = (data.chunk || [])
    .filter((e) => e.type === "m.room.message")
    .reverse();
  return messages
    .map((m) => {
      const time = new Date(m.origin_server_ts).toLocaleTimeString();
      const sender = m.sender.split(":")[0].replace("@", "");
      return `[${time}] ${sender}: ${m.content?.body || "[no text]"}`;
    })
    .join("\n") || "No messages";
}

async function mailInbox({ limit = 10 }) {
  // Get inbox ID
  const mbRes = await jmapRequest([
    ["Mailbox/get", { properties: ["id", "name", "role"] }, "boxes"],
  ]);
  const boxes = mbRes.find((r) => r[2] === "boxes")?.[1]?.list || [];
  const inbox = boxes.find((b) => b.role === "inbox");
  if (!inbox) return "No inbox found";

  // Query emails
  const emailRes = await jmapRequest([
    ["Email/query", {
      filter: { inMailbox: inbox.id },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit,
    }, "ids"],
    ["Email/get", {
      "#ids": { resultOf: "ids", name: "Email/query", path: "/ids" },
      properties: ["id", "from", "subject", "receivedAt", "preview"],
    }, "emails"],
  ]);

  const emails = emailRes.find((r) => r[2] === "emails")?.[1]?.list || [];
  return emails
    .map((e) => {
      const date = new Date(e.receivedAt).toLocaleDateString();
      const from = e.from?.[0]?.email || "unknown";
      return `${date} | ${from} | ${e.subject || "(no subject)"}\nID: ${e.id}\n${e.preview?.slice(0, 100) || ""}`;
    })
    .join("\n---\n") || "Inbox is empty";
}

async function mailRead({ id }) {
  const res = await jmapRequest([
    ["Email/get", {
      ids: [id],
      properties: ["from", "to", "subject", "receivedAt", "textBody", "bodyValues"],
      fetchTextBodyValues: true,
    }, "email"],
  ]);
  const email = res.find((r) => r[2] === "email")?.[1]?.list?.[0];
  if (!email) return `Email ${id} not found`;

  const from = email.from?.map((a) => `${a.name || ""} <${a.email}>`).join(", ");
  const to = email.to?.map((a) => `${a.name || ""} <${a.email}>`).join(", ");
  const bodyPart = email.textBody?.[0];
  const body = bodyPart && email.bodyValues?.[bodyPart.partId]
    ? email.bodyValues[bodyPart.partId].value
    : "[No text body]";

  return `From: ${from}\nTo: ${to}\nDate: ${new Date(email.receivedAt).toLocaleString()}\nSubject: ${email.subject}\n---\n${body}`;
}

async function mailMailboxes() {
  const res = await jmapRequest([
    ["Mailbox/get", { properties: ["id", "name", "role", "totalEmails", "unreadEmails"] }, "boxes"],
  ]);
  const boxes = res.find((r) => r[2] === "boxes")?.[1]?.list || [];
  return boxes
    .map((b) => `${b.name}${b.role ? ` (${b.role})` : ""} — ${b.totalEmails || 0} total${b.unreadEmails ? `, ${b.unreadEmails} unread` : ""}`)
    .join("\n") || "No mailboxes";
}

async function driveList({ path = "/" }) {
  let dirId = path === "/" ? "io.cozy.files.root-dir" : path;
  if (path !== "/" && !path.startsWith("io.cozy.files")) {
    const resolved = await cozyFetch(`/files/metadata?Path=${encodeURIComponent(path)}`);
    dirId = resolved.data?.id;
  }
  const data = await cozyFetch(`/files/${dirId}`);
  const contents = data.included || [];
  return contents
    .map((item) => {
      const attrs = item.attributes || {};
      const type = attrs.type === "directory" ? "DIR" : "FILE";
      const size = attrs.size ? `${(attrs.size / 1024).toFixed(1)}KB` : "";
      return `[${type}] ${attrs.name || item.id} ${size}`;
    })
    .join("\n") || "(empty folder)";
}

async function driveRead({ id }) {
  const instanceUrl = process.env.TWAKE_COZY_URL;
  const token = process.env.TWAKE_COZY_TOKEN;
  const res = await fetch(`${instanceUrl}/files/downloads/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return await res.text();
}

async function driveUpload({ name, content, folder = "io.cozy.files.root-dir" }) {
  const instanceUrl = process.env.TWAKE_COZY_URL;
  const token = process.env.TWAKE_COZY_TOKEN;
  const res = await fetch(
    `${instanceUrl}/files/${folder}?Type=file&Name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: content,
    }
  );
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return `Uploaded ${name} (ID: ${data.data?.id})`;
}

async function searchAll({ query }) {
  const results = [];

  // Search chat
  try {
    const data = await matrixFetch("/joined_rooms");
    for (const roomId of (data.joined_rooms || []).slice(0, 5)) {
      const msgs = await matrixFetch(
        `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`
      );
      const matches = (msgs.chunk || [])
        .filter((e) => e.type === "m.room.message" && e.content?.body?.toLowerCase().includes(query.toLowerCase()));
      for (const m of matches) {
        const sender = m.sender.split(":")[0].replace("@", "");
        results.push(`[Chat] ${sender}: ${m.content.body}`);
      }
    }
  } catch { /* chat not configured */ }

  // Search mail
  try {
    const emailRes = await jmapRequest([
      ["Email/query", { filter: { text: query }, sort: [{ property: "receivedAt", isAscending: false }], limit: 5 }, "ids"],
      ["Email/get", { "#ids": { resultOf: "ids", name: "Email/query", path: "/ids" }, properties: ["from", "subject", "preview"] }, "emails"],
    ]);
    const emails = emailRes.find((r) => r[2] === "emails")?.[1]?.list || [];
    for (const e of emails) {
      results.push(`[Mail] ${e.from?.[0]?.email}: ${e.subject}`);
    }
  } catch { /* mail not configured */ }

  // Search drive
  try {
    const data = await cozyFetch(`/files/_find`, {
      method: "POST",
      body: JSON.stringify({ selector: { name: { "$regex": `(?i)${query}` } }, limit: 5 }),
    });
    for (const doc of data.docs || []) {
      results.push(`[Drive] ${doc.name} (${doc.type})`);
    }
  } catch { /* drive not configured */ }

  return results.join("\n") || `No results for "${query}"`;
}

// ============================================================
//  MCP Server Setup
// ============================================================

const TOOLS = [
  {
    name: "twake_chat_send",
    description: "Send a message to a Twake Chat room via Matrix protocol",
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room ID (e.g. !abc123:twake.app)" },
        message: { type: "string", description: "Message text to send" },
      },
      required: ["room", "message"],
    },
  },
  {
    name: "twake_chat_rooms",
    description: "List all joined Twake Chat rooms",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "twake_chat_history",
    description: "Get recent messages from a Twake Chat room",
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room ID" },
        limit: { type: "number", description: "Max messages (default 20)" },
      },
      required: ["room"],
    },
  },
  {
    name: "twake_mail_inbox",
    description: "List recent emails from Twake Mail inbox",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max emails (default 10)" },
      },
    },
  },
  {
    name: "twake_mail_read",
    description: "Read a specific email by ID from Twake Mail",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Email ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "twake_mail_mailboxes",
    description: "List all mailboxes/folders in Twake Mail",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "twake_drive_list",
    description: "List files and folders in Twake Drive",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path or ID (default: /)" },
      },
    },
  },
  {
    name: "twake_drive_read",
    description: "Read a text file from Twake Drive by file ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "File ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "twake_drive_upload",
    description: "Upload text content as a file to Twake Drive",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name" },
        content: { type: "string", description: "File content" },
        folder: { type: "string", description: "Destination folder ID (default: root)" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "twake_search",
    description: "Search across all Twake services (chat, mail, drive)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
];

const TOOL_HANDLERS = {
  twake_chat_send: chatSend,
  twake_chat_rooms: chatRooms,
  twake_chat_history: chatHistory,
  twake_mail_inbox: mailInbox,
  twake_mail_read: mailRead,
  twake_mail_mailboxes: mailMailboxes,
  twake_drive_list: driveList,
  twake_drive_read: driveRead,
  twake_drive_upload: driveUpload,
  twake_search: searchAll,
};

const server = new Server(
  { name: "twake-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await handler(args || {});
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
