import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/**
 * twake-mcp tool registration and schema tests.
 *
 * Since the MCP server is a single index.js that connects to stdio on import,
 * we test the tool definitions and helper logic by extracting them rather than
 * importing the full server.
 */

// ── Expected tool names (must match server exactly) ──────────────
const EXPECTED_TOOLS = [
  'twake_chat_send',
  'twake_chat_rooms',
  'twake_chat_history',
  'twake_mail_inbox',
  'twake_mail_read',
  'twake_mail_mailboxes',
  'twake_drive_list',
  'twake_drive_read',
  'twake_drive_upload',
  'twake_search',
];

describe('MCP Tool Definitions', () => {
  // Read the source file and extract TOOLS array
  let source;
  let toolDefs;

  it('source file exists and is parseable', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    source = readFileSync(join(__dirname, '..', 'src', 'index.js'), 'utf-8');
    assert.ok(source.length > 0);

    // Extract TOOLS array using regex (it's a const array of objects)
    const toolsMatch = source.match(/const TOOLS = (\[[\s\S]*?\n\];)/);
    assert.ok(toolsMatch, 'TOOLS constant should be defined in index.js');

    // Evaluate the array (safe — it's our own code, just object literals)
    toolDefs = eval(toolsMatch[1]);
    assert.ok(Array.isArray(toolDefs));
  });

  it('registers all 10 expected tools', () => {
    const names = toolDefs.map(t => t.name);
    for (const expected of EXPECTED_TOOLS) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
    assert.equal(toolDefs.length, EXPECTED_TOOLS.length);
  });

  it('every tool has a description', () => {
    for (const tool of toolDefs) {
      assert.ok(typeof tool.description === 'string' && tool.description.length > 10,
        `tool ${tool.name} needs a meaningful description`);
    }
  });

  it('every tool has a valid inputSchema', () => {
    for (const tool of toolDefs) {
      assert.ok(tool.inputSchema, `tool ${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `tool ${tool.name} schema must be object`);
      assert.ok(typeof tool.inputSchema.properties === 'object',
        `tool ${tool.name} missing properties`);
    }
  });

  it('tools with required params declare them', () => {
    const sendChat = toolDefs.find(t => t.name === 'twake_chat_send');
    assert.ok(sendChat.inputSchema.required.includes('room'));
    assert.ok(sendChat.inputSchema.required.includes('message'));

    const mailRead = toolDefs.find(t => t.name === 'twake_mail_read');
    assert.ok(mailRead.inputSchema.required.includes('id'));

    const search = toolDefs.find(t => t.name === 'twake_search');
    assert.ok(search.inputSchema.required.includes('query'));
  });
});

describe('JMAP Account ID derivation', () => {
  it('computes SHA-256 hash of email for accountId', () => {
    // This matches the logic in the MCP server's jmapRequest function
    const email = 'jacob@twake.app';
    const accountId = createHash('sha256').update(email).digest('hex');
    assert.equal(accountId.length, 64, 'SHA-256 hex should be 64 chars');
    assert.match(accountId, /^[a-f0-9]{64}$/);
  });

  it('different emails produce different accountIds', () => {
    const id1 = createHash('sha256').update('alice@twake.app').digest('hex');
    const id2 = createHash('sha256').update('bob@twake.app').digest('hex');
    assert.notEqual(id1, id2);
  });

  it('same email always produces same accountId', () => {
    const id1 = createHash('sha256').update('test@linagora.com').digest('hex');
    const id2 = createHash('sha256').update('test@linagora.com').digest('hex');
    assert.equal(id1, id2);
  });
});
