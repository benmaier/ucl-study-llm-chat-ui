import { createThreadHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../../chat-config";

export const { GET, PUT } = createThreadHandler(chatConfig);
