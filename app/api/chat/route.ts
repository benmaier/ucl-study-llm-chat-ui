import { createChatHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../chat-config";

export const { POST } = createChatHandler(chatConfig);
