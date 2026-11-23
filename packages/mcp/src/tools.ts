// Tool registry of the MCP server (docs/design-docs/mcp-test-env.md, "Tools"):
// each tool adds its `McpServer.toolkit(...)` layer here.
import { Layer } from "effect";

export const tools = Layer.empty;
