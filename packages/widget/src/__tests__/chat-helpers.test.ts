/**
 * Tests for chat handler helper functions.
 */

import { describe, it, expect } from "vitest";
import { extractText, extractFiles, dataUrlToBuffer, buildSandboxPath } from "../server/handlers/chat.js";

describe("extractText", () => {
  it("extracts text from parts-based message", () => {
    const msg = {
      role: "user",
      parts: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    };
    expect(extractText(msg)).toBe("Hello world");
  });

  it("extracts text from content string", () => {
    const msg = { role: "user", content: "Hello world" };
    expect(extractText(msg)).toBe("Hello world");
  });

  it("returns empty string for undefined", () => {
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for empty parts", () => {
    const msg = { role: "user", parts: [] };
    expect(extractText(msg)).toBe("");
  });

  it("ignores non-text parts", () => {
    const msg = {
      role: "user",
      parts: [
        { type: "text", text: "Hello" },
        { type: "file", url: "data:..." },
        { type: "text", text: " world" },
      ],
    };
    expect(extractText(msg)).toBe("Hello world");
  });

  it("prefers parts over content", () => {
    const msg = {
      role: "user",
      content: "from content",
      parts: [{ type: "text", text: "from parts" }],
    };
    expect(extractText(msg)).toBe("from parts");
  });
});

describe("extractFiles", () => {
  it("extracts file parts", () => {
    const msg = {
      role: "user",
      parts: [
        { type: "text", text: "Here is a file" },
        { type: "file", url: "data:image/png;base64,abc", mediaType: "image/png", filename: "plot.png" },
      ],
    };
    const files = extractFiles(msg);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      url: "data:image/png;base64,abc",
      mediaType: "image/png",
      filename: "plot.png",
    });
  });

  it("returns empty array for no files", () => {
    const msg = { role: "user", parts: [{ type: "text", text: "no files" }] };
    expect(extractFiles(msg)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(extractFiles(undefined)).toEqual([]);
  });

  it("defaults mediaType and filename", () => {
    const msg = {
      role: "user",
      parts: [{ type: "file", url: "data:;base64,abc" }],
    };
    const files = extractFiles(msg);
    expect(files[0].mediaType).toBe("application/octet-stream");
    expect(files[0].filename).toBe("upload");
  });
});

describe("dataUrlToBuffer", () => {
  it("decodes base64 data URL to Buffer", () => {
    const text = "Hello, World!";
    const base64 = Buffer.from(text).toString("base64");
    const dataUrl = `data:text/plain;base64,${base64}`;
    const buf = dataUrlToBuffer(dataUrl);
    expect(buf.toString()).toBe(text);
  });

  it("handles binary data", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    const buf = dataUrlToBuffer(dataUrl);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });
});

describe("buildSandboxPath", () => {
  // Mappings verified empirically against live APIs (April 2026):
  //   listdir(.) on Gemini      → ['input_file_0.csv']
  //   listdir(/mnt/data) OpenAI → ['file-XXXX-probe.csv']
  //   $INPUT_DIR Anthropic      → /files/input/<opaque>/probe.csv

  it("OpenAI: /mnt/data/<file_id>-<filename>", () => {
    expect(buildSandboxPath("openai", 0, "probe.csv", "file-ABC123")).toBe(
      "/mnt/data/file-ABC123-probe.csv",
    );
  });

  it("OpenAI: works with multi-dot filenames", () => {
    expect(buildSandboxPath("openai", 0, "data.tar.gz", "file-XYZ")).toBe(
      "/mnt/data/file-XYZ-data.tar.gz",
    );
  });

  it("Gemini: input_file_<index>.<ext> with extension preserved", () => {
    expect(buildSandboxPath("gemini", 0, "probe.csv", "ignored")).toBe("input_file_0.csv");
    expect(buildSandboxPath("gemini", 3, "data.json", "ignored")).toBe("input_file_3.json");
  });

  it("Gemini: keeps last extension on multi-dot filenames", () => {
    expect(buildSandboxPath("gemini", 0, "archive.tar.gz", "ignored")).toBe(
      "input_file_0.gz",
    );
  });

  it("Gemini: no extension when filename has no dot", () => {
    expect(buildSandboxPath("gemini", 0, "README", "ignored")).toBe("input_file_0");
  });

  it("Anthropic: $INPUT_DIR/<filename>", () => {
    expect(buildSandboxPath("anthropic", 0, "probe.csv", "file_abc")).toBe(
      "$INPUT_DIR/probe.csv",
    );
  });

  it("Anthropic: ignores file_id (sandbox uses displayName)", () => {
    expect(buildSandboxPath("anthropic", 5, "data.json", "completely_different_id")).toBe(
      "$INPUT_DIR/data.json",
    );
  });
});
