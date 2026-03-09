/**
 * Serves generated files (plots, images) by ID.
 * Files are stored in data/files/ by the stream mapper.
 */

import { readFileSync, existsSync } from "fs";
import path from "path";

const FILES_DIR = path.resolve("data/files");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Sanitize to prevent path traversal
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const filePath = path.join(FILES_DIR, safe);

  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const data = readFileSync(filePath);
  const ext = path.extname(safe).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain; charset=utf-8",
  };

  return new Response(data, {
    headers: {
      "Content-Type": mimeMap[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
