/**
 * GET /api/threads/[id]/messages
 *
 * Reads conversation.json and converts turns into assistant-ui
 * ThreadMessageLike[] format for rendering in the UI.
 */

import {
  filePathForThread,
  artifactsDirForThread,
} from "@/app/api/chat/conversation-store";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import crypto from "crypto";
import path from "path";

interface StoredFile {
  fileId: string;
  filename: string;
  mimeType?: string;
  base64Data?: string;
}

interface CodeArtifact {
  id: string;
  path: string;
  code: string;
  language: string;
}

interface TurnRecord {
  turnNumber: number;
  userMessage: string;
  assistantText: string;
  codeArtifacts: CodeArtifact[];
  generatedFiles: StoredFile[];
  attachedFileIds: string[];
}

interface SerializedConversation {
  id: string;
  turns: TurnRecord[];
}

/** AI SDK UIMessage part types */
interface TextUIPart {
  type: "text";
  text: string;
}

interface DynamicToolUIPart {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state: "output-available";
  input: unknown;
  output: unknown;
}

type UIPart = TextUIPart | DynamicToolUIPart;

interface UIMessageOut {
  role: "user" | "assistant";
  id: string;
  parts: UIPart[];
}

/**
 * Ensure a StoredFile with base64Data is written to the artifacts dir.
 * Returns the filename (UUID + ext) used for the URL.
 */
function ensureArtifactFile(
  file: StoredFile,
  artifactsDir: string,
): string | null {
  if (!file.base64Data) return null;

  // Determine extension from original filename or mime type
  const origExt = path.extname(file.filename || ".png") || ".png";

  // Check if it's actually an image by decoding first few bytes
  const buf = Buffer.from(file.base64Data, "base64");
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isImage = isPng || isJpeg;
  const ext = isImage ? origExt : ".txt";

  const id = crypto.randomUUID() + ext;
  const filePath = path.join(artifactsDir, id);

  if (!existsSync(filePath)) {
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(filePath, buf);
  }

  return id;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: threadId } = await params;
  const filePath = filePathForThread(threadId);

  if (!existsSync(filePath)) {
    return Response.json({ messages: [] });
  }

  let data: SerializedConversation;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return Response.json({ messages: [] });
  }

  const artifactsDir = artifactsDirForThread(threadId);
  const messages: UIMessageOut[] = [];

  for (const turn of data.turns) {
    // User message
    messages.push({
      role: "user",
      id: `user-${turn.turnNumber}`,
      parts: [{ type: "text", text: turn.userMessage }],
    });

    // Build text content — assistant text + generated file references
    let text = turn.assistantText;

    // Append generated files as markdown
    if (turn.generatedFiles?.length) {
      const seenHashes = new Set<string>();
      const fileRefs: string[] = [];

      for (const file of turn.generatedFiles) {
        // Deduplicate by hash
        if (file.base64Data) {
          const hash = crypto
            .createHash("sha256")
            .update(Buffer.from(file.base64Data, "base64"))
            .digest("hex");
          if (seenHashes.has(hash)) continue;
          seenHashes.add(hash);
        }

        const artifactId = ensureArtifactFile(file, artifactsDir);
        if (artifactId) {
          const buf = Buffer.from(file.base64Data!, "base64");
          const isPng =
            buf[0] === 0x89 &&
            buf[1] === 0x50 &&
            buf[2] === 0x4e &&
            buf[3] === 0x47;
          const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
          const isImage = isPng || isJpeg;
          const displayName = isImage
            ? file.filename
            : file.filename.replace(/\.\w+$/, ".txt");
          const url = `/api/threads/${threadId}/artifacts/${artifactId}`;

          if (isImage) {
            fileRefs.push(`![${displayName}](${url})`);
          } else {
            fileRefs.push(`[${displayName}](${url})`);
          }
        }
      }

      if (fileRefs.length > 0) {
        text += "\n\n" + fileRefs.join("\n\n");
      }
    }

    const assistantParts: UIPart[] = [];
    if (text) {
      assistantParts.push({ type: "text", text });
    }

    // Add tool-call parts for code artifacts
    if (turn.codeArtifacts?.length) {
      for (let i = 0; i < turn.codeArtifacts.length; i++) {
        const artifact = turn.codeArtifacts[i];
        assistantParts.push({
          type: "dynamic-tool",
          toolName: "code_execution",
          toolCallId: `tool-${turn.turnNumber}-${i}`,
          state: "output-available",
          input: { code: artifact.code },
          output: "Execution complete",
        });
      }
    }

    messages.push({
      role: "assistant",
      id: `assistant-${turn.turnNumber}`,
      parts: assistantParts,
    });
  }

  return Response.json({ messages });
}
