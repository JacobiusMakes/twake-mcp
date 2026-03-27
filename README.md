# twake-mcp

MCP server for [Twake Workplace](https://linagora.com/en/twake-workplace) — connect any AI assistant to Linagora's collaboration suite.

## What it does

Exposes Twake Workplace (Chat, Mail, Drive) as [MCP](https://modelcontextprotocol.io) tools that AI assistants like Claude, GPT, or Linagora's own LUCIE can use to interact with your workspace.

An AI assistant with twake-mcp can:
- Read and send chat messages
- Check your email inbox and read individual emails
- Browse, read, and upload files to Drive
- Search across all services simultaneously

## Tools

| Tool | Description |
|------|-------------|
| `twake_chat_send` | Send a message to a chat room |
| `twake_chat_rooms` | List joined rooms |
| `twake_chat_history` | Get recent messages |
| `twake_mail_inbox` | List inbox emails |
| `twake_mail_read` | Read a specific email |
| `twake_mail_mailboxes` | List mail folders |
| `twake_drive_list` | List files and folders |
| `twake_drive_read` | Read a file |
| `twake_drive_upload` | Upload content |
| `twake_search` | Search across all services |

## Setup

```bash
npm install
```

Configure via environment variables:

```bash
# Twake Chat (Matrix)
export TWAKE_MATRIX_HOMESERVER=https://matrix.twake.app
export TWAKE_MATRIX_TOKEN=syt_...
export TWAKE_MATRIX_USER=@jacob:twake.app

# Twake Mail (JMAP)
export TWAKE_JMAP_URL=https://jmap.twake.app/jmap
export TWAKE_JMAP_TOKEN=eyJ...

# Twake Drive (Cozy)
export TWAKE_COZY_URL=https://jacob.twake.app
export TWAKE_COZY_TOKEN=eyJ...
```

## Usage with Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "twake": {
      "command": "node",
      "args": ["/path/to/twake-mcp/src/index.js"],
      "env": {
        "TWAKE_MATRIX_HOMESERVER": "https://matrix.twake.app",
        "TWAKE_MATRIX_TOKEN": "your-token",
        "TWAKE_JMAP_URL": "https://jmap.twake.app/jmap",
        "TWAKE_JMAP_TOKEN": "your-token",
        "TWAKE_COZY_URL": "https://jacob.twake.app",
        "TWAKE_COZY_TOKEN": "your-token"
      }
    }
  }
}
```

Then ask Claude: *"Check my Twake inbox"* or *"Send a message to #engineering on Twake"*

## Architecture

```
twake-mcp/
└── src/
    └── index.js          # Single-file MCP server
                           ├── API clients (Matrix, JMAP, Cozy)
                           ├── Tool implementations (10 tools)
                           └── MCP server setup (stdio transport)
```

```
┌──────────────────┐       ┌──────────────┐       ┌──────────────┐
│   AI Assistant   │       │   twake-mcp  │       │    Twake      │
│ (Claude, LUCIE,  │──────▶│  MCP Server  │──────▶│  Workplace    │
│  GPT, etc.)      │ stdio │              │ HTTPS │  (Chat/Mail/  │
│                  │◀──────│              │◀──────│   Drive)      │
└──────────────────┘       └──────────────┘       └──────────────┘
```

The server uses the `@modelcontextprotocol/sdk` stdio transport. Each tool maps directly to a Twake service API call — Matrix Client-Server API for chat, JMAP (RFC 8620/8621) for mail, and Cozy API for drive.

Zero dependencies beyond the MCP SDK. All HTTP calls use Node.js native `fetch`.

## Why

Linagora is building LUCIE, an open-source multilingual LLM. This MCP server makes Twake Workplace AI-accessible, enabling LUCIE (or any AI) to interact with the collaboration suite. It's the bridge between Linagora's AI strategy and their product ecosystem.

## License

AGPL-3.0 (matching Linagora's licensing)
