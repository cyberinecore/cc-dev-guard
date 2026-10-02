const str = (v) => typeof v === "string" && v !== "";

const SHAPES = {
  write_file: (i) => (str(i.path) && typeof i.content === "string" ? [{ path: i.path, isDir: false }] : null),
  edit_file: (i) => (str(i.path) && Array.isArray(i.edits) ? (i.dryRun === true ? [] : [{ path: i.path, isDir: false }]) : null),
  create_directory: (i) => (str(i.path) && Object.keys(i).every((k) => k === "path") ? [{ path: i.path, isDir: true }] : null),
  move_file: (i) => (str(i.source) && str(i.destination) ? [{ path: i.source, isDir: false }, { path: i.destination, isDir: false }] : null),
};

export const MCP_FS_TOOLS = Object.keys(SHAPES);

export function mcpWriteTargets(toolName, toolInput) {
  const m = /^mcp__.+__([a-z_]+)$/.exec(String(toolName || ""));
  if (!m || !Object.prototype.hasOwnProperty.call(SHAPES, m[1])) return null;
  if (!toolInput || typeof toolInput !== "object") return null;
  return SHAPES[m[1]](toolInput);
}
