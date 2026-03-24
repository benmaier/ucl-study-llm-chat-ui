import { createArtifactsHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../../../../chat-config";

export const { GET } = createArtifactsHandler(chatConfig);
